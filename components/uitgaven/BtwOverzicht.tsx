'use client';

import { useEffect, useMemo, useState } from 'react';
import { euro, uitgavenApi, UitgavenApiFout } from '@/lib/uitgaven/client';
import type { BtwOverzicht as Overzicht } from '@/lib/uitgaven/btw';
import { kwartaalVan, perCategorie, type Uitgave } from '@/lib/uitgaven/model';
import { UgIcoon } from './Iconen';

/**
 * Btw & cijfers: per kwartaal de voorbelasting (btw op uitgaven) tegenover de btw op
 * verstuurde facturen, met een indicatie te betalen/terug te vragen. Daaronder de uitgaven
 * per categorie (heel jaar, of het aangeklikte kwartaal).
 */
export function BtwOverzicht({ vandaag, versie }: { vandaag: string; versie: number }) {
  const huidigJaar = Number(vandaag.slice(0, 4));
  const [jaar, setJaar] = useState(huidigJaar);
  const [kwartaal, setKwartaal] = useState<number | null>(null);
  const [data, setData] = useState<{ jaar: number; overzicht: Overzicht; uitgaven: Uitgave[] } | null>(null);
  const [fout, setFout] = useState<{ jaar: number; tekst: string } | null>(null);

  useEffect(() => {
    let weg = false;
    Promise.all([uitgavenApi.btw(jaar), uitgavenApi.lijst(`${jaar}-01-01`, `${jaar}-12-31`)])
      .then(([b, l]) => {
        if (weg) return;
        setData({ jaar, overzicht: b.overzicht, uitgaven: l.uitgaven.filter((u) => u.datum) });
        setFout(null);
      })
      .catch((e) => {
        if (!weg)
          setFout({
            jaar,
            tekst: e instanceof UitgavenApiFout && e.nietIngericht ? e.message : e instanceof Error ? e.message : 'Laden mislukt.'
          });
      });
    return () => {
      weg = true;
    };
  }, [jaar, versie]);

  const actueel = data && data.jaar === jaar ? data : null;
  const huidigKwartaal = jaar === huidigJaar ? kwartaalVan(vandaag) : null;
  const categorieen = useMemo(() => {
    if (!actueel) return [];
    const lijst = kwartaal ? actueel.uitgaven.filter((u) => u.datum && kwartaalVan(u.datum) === kwartaal) : actueel.uitgaven;
    return perCategorie(lijst);
  }, [actueel, kwartaal]);
  const max = Math.max(1, ...categorieen.map((c) => c.excl));

  return (
    <div className="ug-btw">
      <div className="ug-btw-kop">
        <div className="ug-periode">
          <button type="button" className="ag-icoonknop" aria-label="Vorig jaar" onClick={() => setJaar((j) => j - 1)}>
            <UgIcoon naam="links" />
          </button>
          <span className="ug-periode-label">{jaar}</span>
          <button type="button" className="ag-icoonknop" aria-label="Volgend jaar" onClick={() => setJaar((j) => j + 1)}>
            <UgIcoon naam="rechts" />
          </button>
        </div>
        <p className="ug-disclaimer">
          Indicatie op basis van je uitgaven en verstuurde facturen. Geen fiscaal advies; je boekhouder of de aangifte is
          leidend.
        </p>
      </div>

      {fout && fout.jaar === jaar ? (
        <p className="ag-fout" role="alert">
          {fout.tekst}
        </p>
      ) : !actueel ? (
        <div className="ug-kwartalen" aria-busy="true">
          {[1, 2, 3, 4].map((q) => (
            <div key={q} className="ug-kwartaal">
              <div className="db-skelet db-skelet-groot" />
              <div className="db-skelet" />
              <div className="db-skelet" style={{ width: '60%' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {!actueel.overzicht.facturenBeschikbaar && (
            <p className="ug-melding">De facturen konden niet worden gelezen; hieronder staat alleen de btw op je uitgaven.</p>
          )}
          <div className="ug-kwartalen">
            {actueel.overzicht.kwartalen.map((k) => {
              const terug = k.saldo < 0;
              return (
                <button
                  type="button"
                  key={k.kwartaal}
                  className={`ug-kwartaal${kwartaal === k.kwartaal ? ' is-aan' : ''}${huidigKwartaal === k.kwartaal ? ' is-nu' : ''}`}
                  aria-pressed={kwartaal === k.kwartaal}
                  onClick={() => setKwartaal((q) => (q === k.kwartaal ? null : k.kwartaal))}
                >
                  <span className="ug-kwartaal-kop">
                    <span className="db-label">
                      Q{k.kwartaal} {jaar}
                    </span>
                    {huidigKwartaal === k.kwartaal && <span className="ag-chip ag-chip-mini">Nu</span>}
                  </span>
                  <span className="ug-saldo">
                    <span className="ug-saldo-bedrag">{euro(Math.abs(k.saldo))}</span>
                    <span className="db-sub">{k.saldo === 0 ? 'Geen saldo' : terug ? 'Terug te vragen (indicatie)' : 'Te betalen (indicatie)'}</span>
                  </span>
                  <dl className="ug-kwartaal-cijfers">
                    <div>
                      <dt>Btw op facturen</dt>
                      <dd>{actueel.overzicht.facturenBeschikbaar ? euro(k.btwFacturen) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Voorbelasting</dt>
                      <dd>− {euro(k.voorbelasting)}</dd>
                    </div>
                    <div>
                      <dt>Omzet excl. btw</dt>
                      <dd>{actueel.overzicht.facturenBeschikbaar ? euro(k.omzetExcl) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Uitgaven excl. btw</dt>
                      <dd>{euro(k.uitgavenExcl)}</dd>
                    </div>
                  </dl>
                  <span className="ug-kwartaal-voet">
                    {k.aantalFacturen} factu{k.aantalFacturen === 1 ? 'ur' : 'ren'}
                    {k.aantalVerlegd ? ` (${k.aantalVerlegd} verlegd)` : ''} · {k.aantalUitgaven} uitgave{k.aantalUitgaven === 1 ? '' : 'n'}
                    {k.andereValuta > 0 && <> · {k.andereValuta} in andere valuta niet meegeteld</>}
                  </span>
                </button>
              );
            })}
          </div>

          <section className="ug-categorieen" aria-label="Uitgaven per categorie">
            <h2 className="db-label">
              Uitgaven per categorie · {kwartaal ? `Q${kwartaal} ${jaar}` : jaar} · excl. btw
            </h2>
            {categorieen.length === 0 ? (
              <p className="ag-uitleg ug-leeg-tekst">Nog geen uitgaven in deze periode.</p>
            ) : (
              <ul className="ug-balken">
                {categorieen.map((c) => (
                  <li key={c.categorie ?? 'geen'} className="ug-balk">
                    <span className="ug-balk-label">
                      {c.label}
                      <span className="ug-balk-aantal">{c.aantal}×</span>
                    </span>
                    <span className="ug-balk-spoor" aria-hidden="true">
                      <span className="ug-balk-vulling" style={{ width: `${Math.max(1.5, (Math.max(0, c.excl) / max) * 100)}%` }} />
                    </span>
                    <span className="ug-balk-bedrag">{euro(c.excl)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
