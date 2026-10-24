'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { centenNaarInvoer, formatCenten, naarCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, langeDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import { ACTIVA_CATEGORIEEN, activumHints, looptijdLabel, type Activum, type SchemaRegel } from '@/lib/boekhouding/kern/afschrijving';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';
import { ActivumFormulier } from './ActivumFormulier';

export interface ActivumView {
  activum: Activum;
  vandaag: Datum;
  boekwaardeNu: Centen;
  perMaand: Centen;
  schema: SchemaRegel[];
  perJaar: { jaar: number; afschrijving: Centen; eind: Centen }[];
  herkomst: { label: string; href: string | null };
  boekwaardeBijDesinvestering: Centen | null;
  boekresultaat: Centen | null;
  /** Melding als aanschaf/termijn vastliggen (afgesloten boekjaar). */
  slot: string | null;
  controle: string | null;
}

// Eén activum: kerngegevens, schema per jaar (en per maand), herkomst, wijzigen,
// desinvesteren (verkoop of buiten gebruik) en verwijderen.
export function ActivumDetail({ view: v }: { view: ActivumView }) {
  const router = useRouter();
  const a = v.activum;
  const [wijzigen, setWijzigen] = useState(false);
  const [maanden, setMaanden] = useState(false);
  const [desinv, setDesinv] = useState(false);
  const [datum, setDatum] = useState(a.desinvesteringDatum ?? v.vandaag);
  const [opbrengst, setOpbrengst] = useState(a.desinvesteringOpbrengst ? centenNaarInvoer(a.desinvesteringOpbrengst) : '');
  const [weg, setWeg] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const totaal = a.aanschaf - a.restwaarde;
  const afgeschreven = a.aanschaf - v.boekwaardeNu;
  const voortgang = a.desinvesteringDatum && a.desinvesteringDatum <= v.vandaag ? 1 : totaal ? Math.min(1, afgeschreven / totaal) : 1;
  const opbrengstC = opbrengst.trim() ? naarCenten(opbrengst) : 0;

  async function stuur(fn: () => Promise<unknown>, daarna?: () => void) {
    setBezig(true);
    setFout(null);
    try {
      await fn();
      daarna?.();
      router.refresh();
    } catch (e) {
      setFout((e as BkApiFout).message);
    } finally {
      setBezig(false);
    }
  }
  const desinvesteren = () =>
    stuur(
      () => bkApi(`/api/boekhouding/activa/${a.id}`, { method: 'PATCH', body: { desinvesteringDatum: datum, desinvesteringOpbrengst: opbrengst || 0 } }),
      () => setDesinv(false)
    );
  const terugdraaien = () => stuur(() => bkApi(`/api/boekhouding/activa/${a.id}`, { method: 'PATCH', body: { desinvesteringDatum: null, desinvesteringOpbrengst: null } }));
  const verwijderen = () => stuur(() => bkApi(`/api/boekhouding/activa/${a.id}`, { method: 'DELETE' }), () => router.push('/boekhouding/activa'));

  return (
    <div className="bh-inhoud bh-activum">
      <nav className="bh-aangifte-nav" aria-label="Terug">
        <Link href="/boekhouding/activa" className="bh-terug">
          ← Activa
        </Link>
      </nav>

      <section className="bh-kaart bh-aangifte-kop" aria-label="Samenvatting">
        <div>
          <p className="bh-label">
            {ACTIVA_CATEGORIEEN[a.categorie].naam} · {looptijdLabel(a.looptijdMaanden)} lineair
          </p>
          <h2 className="bh-btw-volgende-titel">
            {a.omschrijving}
            {a.desinvesteringDatum ? <span className="bh-pil is-zacht">{a.desinvesteringOpbrengst ? 'verkocht' : 'buiten gebruik'}</span> : v.boekwaardeNu <= a.restwaarde && v.schema.length ? <span className="bh-pil is-zacht">afgeschreven</span> : <span className="bh-pil is-koppel">in gebruik</span>}
          </h2>
          <p className="bh-kaart-sub">
            Aangeschaft {langeDatum(a.aanschafdatum)}
            {a.ingebruikname !== a.aanschafdatum ? ` · in gebruik vanaf ${langeDatum(a.ingebruikname)}` : ''} ·{' '}
            {v.herkomst.href ? <Link href={v.herkomst.href}>{v.herkomst.label}</Link> : v.herkomst.label}
          </p>
        </div>
        <div className="bh-btw-volgende-bedrag">
          <span className="bh-btw-groot">{formatCenten(v.boekwaardeNu)}</span>
          <span className="bh-kaart-sub">boekwaarde vandaag</span>
        </div>
      </section>

      {v.controle && (
        <div className="bh-afwijking" role="status">
          <strong>Controleren.</strong> {v.controle}
        </div>
      )}

      <section className="bh-saldi" aria-label="Kerncijfers">
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Aanschafprijs</span>
          <span className="bh-saldo-bedrag">{formatCenten(a.aanschaf)}</span>
          <span className="bh-saldo-sub">excl. btw{a.restwaarde ? ` · restwaarde ${formatCenten(a.restwaarde)}` : ''}</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Per maand</span>
          <span className="bh-saldo-bedrag">{formatCenten(v.perMaand)}</span>
          <span className="bh-saldo-sub">{formatCenten(v.perMaand * 12)} per jaar</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Afgeschreven</span>
          <span className="bh-saldo-bedrag">{formatCenten(afgeschreven)}</span>
          <span className="bh-voortgang is-groot" aria-hidden="true">
            <span style={{ width: `${Math.round(voortgang * 100)}%` }} />
          </span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Laatste afschrijving</span>
          <span className="bh-saldo-bedrag">{v.schema.length ? korteDatum(v.schema[v.schema.length - 1].datum) : '—'}</span>
          <span className="bh-saldo-sub">{v.schema.length} maanden</span>
        </div>
      </section>

      {activumHints(a)
        .filter((h) => h.soort === 'let_op')
        .map((h) => (
          <p key={h.tekst} className="bh-uitkomst-noot is-let-op">
            {h.tekst}
          </p>
        ))}

      <div className="bh-open-grid">
        <section className="bh-kaart" aria-labelledby="bh-schema-titel">
          <header className="bh-lijst-kop">
            <h2 id="bh-schema-titel" className="bh-kaart-titel">
              Afschrijvingsschema
            </h2>
            <button type="button" className="ag-link-knop" onClick={() => setMaanden(!maanden)} aria-expanded={maanden}>
              {maanden ? 'Per jaar' : 'Per maand'}
            </button>
          </header>
          <div className="bh-schema" role="table">
            <div className="bh-schema-rij bh-th" role="row">
              <span role="columnheader">{maanden ? 'Maand' : 'Jaar'}</span>
              <span role="columnheader" className="bh-r">
                Afschrijving
              </span>
              <span role="columnheader" className="bh-r">
                Boekwaarde
              </span>
            </div>
            {maanden
              ? v.schema.map((r) => (
                  <div key={r.maand} className={`bh-schema-rij${r.datum <= v.vandaag ? '' : ' is-toekomst'}`} role="row">
                    <span role="cell">{korteDatum(r.datum)}</span>
                    <span role="cell" className="bh-r">
                      {formatCenten(r.afschrijving)}
                    </span>
                    <span role="cell" className="bh-r">
                      {formatCenten(r.boekwaarde)}
                    </span>
                  </div>
                ))
              : v.perJaar.map((r) => (
                  <div key={r.jaar} className={`bh-schema-rij${String(r.jaar) <= v.vandaag.slice(0, 4) ? '' : ' is-toekomst'}`} role="row">
                    <span role="cell">{r.jaar}</span>
                    <span role="cell" className="bh-r">
                      {formatCenten(r.afschrijving)}
                    </span>
                    <span role="cell" className="bh-r">
                      {formatCenten(r.eind)}
                    </span>
                  </div>
                ))}
          </div>
          <p className="bh-kaart-sub">Geboekt als kosten (afschrijvingen) op de laatste dag van elke maand; toekomstige maanden staan lichter.</p>
        </section>

        <section className="bh-kaart" aria-labelledby="bh-desinv-titel">
          <h2 id="bh-desinv-titel" className="bh-kaart-titel">
            Verkopen of afvoeren
          </h2>
          {a.desinvesteringDatum ? (
            <>
              <dl className="bh-totalen">
                <div>
                  <dt>Datum</dt>
                  <dd>{korteDatum(a.desinvesteringDatum)}</dd>
                </div>
                <div>
                  <dt>Opbrengst excl. btw</dt>
                  <dd>{formatCenten(a.desinvesteringOpbrengst ?? 0)}</dd>
                </div>
                <div>
                  <dt>Boekwaarde</dt>
                  <dd>{formatCenten(v.boekwaardeBijDesinvestering ?? 0)}</dd>
                </div>
                <div>
                  <dt>{(v.boekresultaat ?? 0) >= 0 ? 'Boekwinst' : 'Boekverlies'}</dt>
                  <dd className={(v.boekresultaat ?? 0) >= 0 ? 'is-bij' : ''}>{formatCenten(Math.abs(v.boekresultaat ?? 0))}</dd>
                </div>
              </dl>
              <p className="bh-kaart-sub">
                De boekwaarde gaat af ten laste van de overige opbrengsten. {a.desinvesteringOpbrengst ? 'Boek de ontvangst bij Bank & boekingen als inkomst, categorie Overige opbrengsten, 21% btw.' : ''}
              </p>
              <button type="button" className="ag-link-knop" onClick={terugdraaien} disabled={bezig}>
                Desinvestering ongedaan maken
              </button>
            </>
          ) : !desinv ? (
            <>
              <p className="bh-kaart-sub">Verkocht, ingeruild of weggegooid? Dan stopt de afschrijving en gaat de resterende boekwaarde af.</p>
              <button type="button" className="db-knop" onClick={() => setDesinv(true)}>
                Desinvesteren…
              </button>
            </>
          ) : (
            <div className="bh-bevestig">
              <div className="bh-rek-velden">
                <label className="bh-veld">
                  <span className="bh-label">Datum</span>
                  <input className="ag-veld" type="date" value={datum} min={a.ingebruikname} max={v.vandaag} onChange={(e) => setDatum(e.target.value)} />
                </label>
                <label className="bh-veld">
                  <span className="bh-label">Opbrengst excl. btw</span>
                  <span className="bh-bedrag-invoer">
                    <span>€</span>
                    <input className="ag-veld" inputMode="decimal" value={opbrengst} onChange={(e) => setOpbrengst(e.target.value)} placeholder="0,00 (weggegooid)" />
                  </span>
                </label>
              </div>
              <p className="bh-uitkomst-noot">
                Afschrijving t/m de maand vóór {korteDatum(datum)}.{opbrengstC ? ' Verkoop: er is 21% btw verschuldigd over de opbrengst; boek de ontvangst als inkomst (Overige opbrengsten).' : ''}
              </p>
              <div className="bh-bevestig-knoppen">
                <button type="button" className="db-knop" onClick={() => setDesinv(false)} disabled={bezig}>
                  Annuleren
                </button>
                <button type="button" className="db-knop db-knop-primair" onClick={desinvesteren} disabled={bezig || opbrengstC === null}>
                  {bezig ? 'Bezig…' : 'Desinvesteren'}
                </button>
              </div>
            </div>
          )}
          {a.notities && <p className="bh-kaart-sub bh-notitie">{a.notities}</p>}
          <div className="bh-detail-acties">
            <button type="button" className="db-knop" onClick={() => setWijzigen(true)}>
              Wijzigen
            </button>
            {!weg ? (
              <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setWeg(true)} disabled={Boolean(v.slot)}>
                Verwijderen
              </button>
            ) : (
              <span className="bh-bevestig-knoppen">
                <span className="bh-kaart-sub">Activum en afschrijvingen verwijderen?</span>
                <button type="button" className="db-knop" onClick={() => setWeg(false)} disabled={bezig}>
                  Nee
                </button>
                <button type="button" className="db-knop ag-knop-gevaar" onClick={verwijderen} disabled={bezig}>
                  Verwijderen
                </button>
              </span>
            )}
          </div>
          {v.slot && <p className="bh-uitkomst-noot">{v.slot}</p>}
          {fout && <p className="ag-fout">{fout}</p>}
        </section>
      </div>

      {wijzigen && (
        <ActivumFormulier
          activum={a}
          vandaag={v.vandaag}
          onSluit={() => setWijzigen(false)}
          onOpgeslagen={() => {
            setWijzigen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
