'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import type { KoppelBron } from '@/lib/boekhouding/kern/bronnen';
import type { Ouderdom, OuderdomTotaal } from '@/lib/boekhouding/kern/afletteren';
import { bkApi } from '@/lib/boekhouding/client';

export interface OpenRij {
  bron: KoppelBron;
  id: string;
  titel: string;
  sub: string;
  datum: Datum;
  dagen: number;
  ouderdom: Ouderdom;
  vervallen: boolean;
  totaal: Centen;
  open: Centen;
  deels: boolean;
  suggesties: { boekingId: string; datum: Datum; bank: string; omschrijving: string; bedrag: Centen; redenen: string[] }[];
}

export interface ControleRij {
  id: string;
  datum: Datum;
  titel: string;
  sub: string;
  bedrag: Centen;
  href: string;
}

export interface Controle {
  id: string;
  titel: string;
  uitleg: string;
  rijen: ControleRij[];
  totaal?: Centen;
}

const OUDERDOM_LABEL: Record<Ouderdom, string> = { '0-30': '0–30 dagen', '31-60': '31–60 dagen', '60+': 'ouder dan 60 dagen' };

function Ouderdomsbalk({ t }: { t: OuderdomTotaal }) {
  const som = Math.abs(t.per['0-30']) + Math.abs(t.per['31-60']) + Math.abs(t.per['60+']);
  return (
    <div className="bh-ouderdom">
      <div className="bh-ouderdom-balk" aria-hidden="true">
        {(['0-30', '31-60', '60+'] as const).map((o) =>
          t.per[o] && som ? <span key={o} className={`bh-ouderdom-deel is-${o === '0-30' ? 'vers' : o === '31-60' ? 'midden' : 'oud'}`} style={{ flexGrow: Math.abs(t.per[o]) / som }} /> : null
        )}
      </div>
      <dl className="bh-ouderdom-legenda">
        {(['0-30', '31-60', '60+'] as const).map((o) => (
          <div key={o}>
            <dt>
              <span className={`bh-stip is-${o === '0-30' ? 'vers' : o === '31-60' ? 'midden' : 'oud'}`} aria-hidden="true" />
              {OUDERDOM_LABEL[o]}
            </dt>
            <dd>{formatCenten(t.per[o])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OpenLijst({ titel, sub, rijen, totaal, leeg, onKoppel, bezig }: { titel: string; sub: string; rijen: OpenRij[]; totaal: OuderdomTotaal; leeg: string; onKoppel: (r: OpenRij, s: OpenRij['suggesties'][number]) => void; bezig: string | null }) {
  return (
    <section className="bh-kaart bh-open" aria-label={titel}>
      <header className="bh-kaart-kop bh-open-kop">
        <div>
          <h2 className="bh-kaart-titel">{titel}</h2>
          <p className="bh-kaart-sub">{sub}</p>
        </div>
        <p className="bh-open-totaal">
          <span className="bh-label">Open</span>
          <span className="bh-open-bedrag">{formatCenten(totaal.open)}</span>
          <span className="bh-kaart-sub">{totaal.aantal === 1 ? '1 post' : `${totaal.aantal} posten`}</span>
        </p>
      </header>
      {rijen.length === 0 ? (
        <p className="bh-leeg">{leeg}</p>
      ) : (
        <>
          <Ouderdomsbalk t={totaal} />
          <ul className="bh-open-lijst">
            {rijen.map((r) => (
              <li key={r.id} className="bh-open-rij">
                <div className="bh-open-hoofd">
                  <span className="bh-open-titel">
                    {r.titel}
                    {r.vervallen && <span className="bh-pil is-let-op">over de termijn</span>}
                    {r.deels && <span className="bh-pil">deels betaald</span>}
                  </span>
                  <span className="bh-rij-meta">
                    {r.sub} · {korteDatum(r.datum)} · {r.dagen} {r.dagen === 1 ? 'dag' : 'dagen'}
                  </span>
                </div>
                <span className="bh-open-bedragen">
                  <span className="bh-open-open">{formatCenten(r.open)}</span>
                  {r.open !== r.totaal && <span className="bh-rij-meta">van {formatCenten(r.totaal)}</span>}
                </span>
                {r.suggesties.map((s) => (
                  <div key={s.boekingId} className="bh-open-sugg">
                    <span className="bh-open-sugg-tekst">
                      <span className="bh-label">Mogelijke betaling</span> {korteDatum(s.datum)} · {s.bank} · {s.omschrijving}
                      <span className="bh-koppel-reden"> — {s.redenen.join(' · ')}</span>
                    </span>
                    <span className="bh-open-sugg-bedrag">{formatCenten(s.bedrag)}</span>
                    <button type="button" className="db-knop db-knop-primair bh-koppel-knop" disabled={bezig !== null} onClick={() => onKoppel(r, s)}>
                      {bezig === `${r.id}:${s.boekingId}` ? 'Bezig…' : 'Koppelen'}
                    </button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// Openstaande posten en de controles van de boekhouder. Koppelen gebeurt met één klik; daarna
// wordt de pagina ververst (alles wordt opnieuw afgeleid uit facturen, bonnetjes en bank).
export function OpenstaandApp({
  debiteuren,
  crediteuren,
  totDeb,
  totCred,
  controles,
  teVerwerken
}: {
  debiteuren: OpenRij[];
  crediteuren: OpenRij[];
  totDeb: OuderdomTotaal;
  totCred: OuderdomTotaal;
  controles: Controle[];
  teVerwerken: number;
}) {
  const router = useRouter();
  const [bezig, setBezig] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'ok' | 'fout' } | null>(null);
  const [uit, setUit] = useState<Record<string, boolean>>({});

  async function koppel(r: OpenRij, s: OpenRij['suggesties'][number]) {
    setBezig(`${r.id}:${s.boekingId}`);
    setMelding(null);
    try {
      await bkApi('/api/boekhouding/koppelingen', { method: 'POST', body: { boekingId: s.boekingId, bron: r.bron, bronId: r.id, bedrag: s.bedrag } });
      setMelding({ tekst: `Gekoppeld: ${r.titel} — ${formatCenten(s.bedrag)}`, soort: 'ok' });
      router.refresh();
    } catch (e) {
      setMelding({ tekst: (e as Error).message, soort: 'fout' });
    } finally {
      setBezig(null);
    }
  }

  const punten = controles.reduce((n, c) => n + c.rijen.length, 0);

  return (
    <div className="bh-inhoud">
      <section className="bh-saldi" aria-label="Samenvatting">
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Te ontvangen</span>
          <span className="bh-saldo-bedrag">{formatCenten(totDeb.open)}</span>
          <span className="bh-saldo-sub">{totDeb.aantal} open {totDeb.aantal === 1 ? 'factuur' : 'facturen'}</span>
        </div>
        <div className="bh-saldo">
          <span className="bh-saldo-naam">Te betalen</span>
          <span className="bh-saldo-bedrag">{formatCenten(totCred.open)}</span>
          <span className="bh-saldo-sub">{totCred.aantal} open {totCred.aantal === 1 ? 'inkoopfactuur' : 'inkoopfacturen'}</span>
        </div>
        <Link className="bh-saldo is-info" href="/boekhouding/bank?status=te_verwerken&jaar=alle">
          <span className="bh-saldo-naam">Te verwerken</span>
          <span className={`bh-saldo-bedrag${teVerwerken ? ' is-let-op' : ''}`}>{teVerwerken}</span>
          <span className="bh-saldo-sub">bankregels controleren</span>
        </Link>
        <div className="bh-saldo is-info">
          <span className="bh-saldo-naam">Controlepunten</span>
          <span className={`bh-saldo-bedrag${punten ? ' is-let-op' : ''}`}>{punten}</span>
          <span className="bh-saldo-sub">{punten ? 'zie hieronder' : 'alles sluit'}</span>
        </div>
      </section>

      {melding && (
        <p className={`bh-melding is-${melding.soort}`} role={melding.soort === 'fout' ? 'alert' : 'status'}>
          {melding.tekst}
        </p>
      )}

      <div className="bh-open-grid">
        <OpenLijst
          titel="Debiteuren"
          sub="Facturen die (nog) niet helemaal betaald zijn. Betaaltermijn 14 dagen."
          rijen={debiteuren}
          totaal={totDeb}
          leeg="Alle facturen zijn betaald."
          onKoppel={koppel}
          bezig={bezig}
        />
        <OpenLijst
          titel="Crediteuren"
          sub="Bonnetjes en inkoopfacturen (zakelijk betaald) zonder bankregel."
          rijen={crediteuren}
          totaal={totCred}
          leeg="Er staan geen inkoopfacturen open."
          onKoppel={koppel}
          bezig={bezig}
        />
      </div>

      <section className="bh-lijst-blok" aria-labelledby="bh-controles">
        <header className="bh-lijst-kop">
          <h2 id="bh-controles" className="bh-kaart-titel">
            Controles voor de boekhouder
          </h2>
        </header>
        <div className="bh-controles">
          {controles.map((c) => {
            const open = uit[c.id] ?? false;
            const zichtbaar = open ? c.rijen : c.rijen.slice(0, 5);
            return (
              <article key={c.id} className={`bh-controle${c.rijen.length ? ' is-punt' : ''}`}>
                <header className="bh-controle-kop">
                  <span className={`bh-controle-teller${c.rijen.length ? ' is-let-op' : ''}`}>{c.rijen.length}</span>
                  <div>
                    <h3 className="bh-controle-titel">{c.titel}</h3>
                    <p className="bh-kaart-sub">{c.uitleg}</p>
                  </div>
                  {c.totaal !== undefined && c.rijen.length > 0 && <span className="bh-controle-totaal">{formatCenten(c.totaal)}</span>}
                </header>
                {c.rijen.length > 0 && (
                  <ul className="bh-controle-lijst">
                    {zichtbaar.map((r) => (
                      <li key={r.id}>
                        <Link className="bh-controle-rij" href={r.href}>
                          <span className="bh-rij-datum">{korteDatum(r.datum)}</span>
                          <span className="bh-rij-hoofd">
                            <span className="bh-rij-titel">{r.titel}</span>
                            <span className="bh-rij-meta">{r.sub}</span>
                          </span>
                          <span className="bh-r bh-rij-bedrag">{formatCenten(r.bedrag)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {c.rijen.length > 5 && (
                  <button type="button" className="ag-link-knop bh-controle-meer" onClick={() => setUit((u) => ({ ...u, [c.id]: !open }))}>
                    {open ? 'Minder tonen' : `Alle ${c.rijen.length} tonen`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
