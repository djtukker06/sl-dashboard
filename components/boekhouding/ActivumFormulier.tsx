'use client';

import { useEffect, useRef, useState } from 'react';
import { centenNaarInvoer, formatCenten, naarCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import {
  ACTIVA_CATEGORIEEN,
  LOOPTIJD_MAX,
  LOOPTIJD_MIN,
  activumHints,
  eindeAfschrijving,
  looptijdLabel,
  maandbedrag,
  schema,
  type Activum,
  type ActivumCategorie
} from '@/lib/boekhouding/kern/afschrijving';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';

export interface ActiveerBron {
  soort: 'boeking' | 'uitgave';
  id: string;
  titel: string;
  datum: Datum;
  /** Bedrag excl. btw van de aankoop (min wat al is geactiveerd). */
  excl: Centen;
}

interface Velden {
  omschrijving: string;
  categorie: ActivumCategorie;
  aanschafdatum: string;
  ingebruikname: string;
  aanschaf: string;
  restwaarde: string;
  maanden: number;
  anders: string;
  notities: string;
}

const SNEL = [36, 60] as const;

function beginVelden(a: Activum | null, bron: ActiveerBron | null, vandaag: Datum): Velden {
  if (a) {
    return {
      omschrijving: a.omschrijving,
      categorie: a.categorie,
      aanschafdatum: a.aanschafdatum,
      ingebruikname: a.ingebruikname,
      aanschaf: centenNaarInvoer(a.aanschaf),
      restwaarde: a.restwaarde ? centenNaarInvoer(a.restwaarde) : '',
      maanden: a.looptijdMaanden,
      anders: SNEL.includes(a.looptijdMaanden as 36 | 60) ? '' : String(a.looptijdMaanden),
      notities: a.notities ?? ''
    };
  }
  return {
    omschrijving: bron?.titel ?? '',
    categorie: '0210',
    aanschafdatum: bron?.datum ?? vandaag,
    ingebruikname: bron?.datum ?? vandaag,
    aanschaf: bron ? centenNaarInvoer(bron.excl) : '',
    restwaarde: '',
    maanden: 60,
    anders: '',
    notities: ''
  };
}

/**
 * Paneel om een activum toe te voegen of te wijzigen: soort, datums, aanschafprijs excl. btw,
 * termijn (snelkeuze 3 of 5 jaar, of een eigen aantal maanden) en restwaarde, met de
 * afschrijving per maand en de hints (onder € 450, fiscaal minimaal 5 jaar) live erbij.
 */
export function ActivumFormulier({
  activum = null,
  bron = null,
  vandaag,
  onSluit,
  onOpgeslagen
}: {
  activum?: Activum | null;
  bron?: ActiveerBron | null;
  vandaag: Datum;
  onSluit: () => void;
  onOpgeslagen: (a: Activum) => void;
}) {
  const [f, setF] = useState<Velden>(() => beginVelden(activum, bron, vandaag));
  const [fout, setFout] = useState<string | null>(null);
  const [veld, setVeld] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const paneel = useRef<HTMLElement>(null);
  const metBron = Boolean(bron || activum?.boekingId || activum?.uitgaveId);

  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSluit();
    };
    window.addEventListener('keydown', toets);
    paneel.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => window.removeEventListener('keydown', toets);
  }, [onSluit]);

  const zet = (w: Partial<Velden>) => setF((x) => ({ ...x, ...w }));
  const aanschaf = naarCenten(f.aanschaf);
  const restwaarde = f.restwaarde.trim() ? naarCenten(f.restwaarde) : 0;
  const maanden = f.anders.trim() ? Number(f.anders) : f.maanden;
  const geldig =
    aanschaf !== null && aanschaf > 0 && restwaarde !== null && restwaarde >= 0 && restwaarde < aanschaf && Number.isInteger(maanden) && maanden >= LOOPTIJD_MIN && maanden <= LOOPTIJD_MAX && /^\d{4}-\d{2}-\d{2}$/.test(f.ingebruikname);
  const voorbeeld = geldig
    ? (() => {
        const proef: Activum = {
          id: 'proef',
          omschrijving: f.omschrijving,
          categorie: f.categorie,
          aanschafdatum: f.aanschafdatum,
          ingebruikname: f.ingebruikname,
          aanschaf: aanschaf!,
          restwaarde: restwaarde!,
          looptijdMaanden: maanden,
          uitgaveId: null,
          boekingId: null,
          desinvesteringDatum: null,
          desinvesteringOpbrengst: null,
          notities: null,
          aangemaakt: ''
        };
        const m = maandbedrag(proef);
        const s = schema(proef);
        return { m, eerste: s[0]?.datum ?? null, einde: eindeAfschrijving(proef), hints: activumHints(proef) };
      })()
    : null;

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    setVeld(null);
    const body: Record<string, unknown> = {
      omschrijving: f.omschrijving,
      categorie: f.categorie,
      ingebruikname: f.ingebruikname,
      aanschaf: f.aanschaf,
      restwaarde: f.restwaarde,
      looptijdMaanden: maanden,
      notities: f.notities
    };
    if (!metBron) body.aanschafdatum = f.aanschafdatum;
    if (!activum && bron) body[bron.soort === 'boeking' ? 'boekingId' : 'uitgaveId'] = bron.id;
    try {
      const { activum: a } = activum
        ? await bkApi<{ activum: Activum }>(`/api/boekhouding/activa/${activum.id}`, { method: 'PATCH', body })
        : await bkApi<{ activum: Activum }>('/api/boekhouding/activa', { method: 'POST', body });
      onOpgeslagen(a);
    } catch (err) {
      const x = err as BkApiFout;
      setFout(x.message);
      setVeld(x.veld ?? null);
      setBezig(false);
    }
  }

  const ongeldig = (naam: string) => (veld === naam ? true : undefined);

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <aside ref={paneel} className="ag-paneel bh-paneel" role="dialog" aria-modal="true" aria-labelledby="bh-activum-titel">
        <form className="ag-paneel-form" onSubmit={opslaan} noValidate>
          <header className="ag-paneel-kop">
            <div>
              <p className="bh-label">{activum ? 'Activum wijzigen' : bron ? 'Aankoop activeren' : 'Nieuw activum'}</p>
              <h2 id="bh-activum-titel" className="bh-paneel-titel">
                {activum?.omschrijving ?? (bron ? bron.titel : 'Investering toevoegen')}
              </h2>
            </div>
            <button type="button" className="ag-icoonknop" onClick={onSluit} aria-label="Sluiten">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="ag-paneel-inhoud">
            {bron && (
              <p className="bh-slot-melding">
                <strong>Uit {bron.soort === 'boeking' ? 'de bankregel' : 'het bonnetje'}:</strong> {bron.titel} van {korteDatum(bron.datum)}, {formatCenten(bron.excl)} excl. btw. De
                aanschafprijs gaat dan niet naar de kosten maar op de balans, en wordt per maand afgeschreven.
              </p>
            )}
            <fieldset className="bh-form bh-activum-form">
              <legend className="bh-sr">Activum</legend>
              <label className="bh-veld bh-breed">
                <span className="bh-label">Omschrijving</span>
                <input className="ag-veld" value={f.omschrijving} onChange={(e) => zet({ omschrijving: e.target.value })} maxLength={200} placeholder='bv. MacBook Pro 14"' aria-invalid={ongeldig('omschrijving')} required />
              </label>
              <div className="bh-veld bh-breed">
                <span className="bh-label" id="bh-act-soort">
                  Soort
                </span>
                <div className="ag-segment bh-segment" role="radiogroup" aria-labelledby="bh-act-soort">
                  {(Object.keys(ACTIVA_CATEGORIEEN) as ActivumCategorie[]).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={f.categorie === c} className={f.categorie === c ? 'is-aan' : ''} onClick={() => zet({ categorie: c })}>
                      {ACTIVA_CATEGORIEEN[c].naam}
                    </button>
                  ))}
                </div>
              </div>
              <label className="bh-veld">
                <span className="bh-label">Aanschafdatum</span>
                <input className="ag-veld" type="date" value={f.aanschafdatum} onChange={(e) => zet({ aanschafdatum: e.target.value, ingebruikname: f.ingebruikname < e.target.value ? e.target.value : f.ingebruikname })} disabled={metBron} aria-invalid={ongeldig('aanschafdatum')} />
              </label>
              <label className="bh-veld">
                <span className="bh-label">In gebruik vanaf</span>
                <input className="ag-veld" type="date" value={f.ingebruikname} min={f.aanschafdatum} onChange={(e) => zet({ ingebruikname: e.target.value })} aria-invalid={ongeldig('ingebruikname')} />
              </label>
              <label className="bh-veld">
                <span className="bh-label">Aanschafprijs excl. btw</span>
                <span className="bh-bedrag-invoer">
                  <span>€</span>
                  <input className="ag-veld" inputMode="decimal" value={f.aanschaf} onChange={(e) => zet({ aanschaf: e.target.value })} placeholder="0,00" aria-invalid={ongeldig('aanschaf')} />
                </span>
              </label>
              <label className="bh-veld">
                <span className="bh-label">Restwaarde</span>
                <span className="bh-bedrag-invoer">
                  <span>€</span>
                  <input className="ag-veld" inputMode="decimal" value={f.restwaarde} onChange={(e) => zet({ restwaarde: e.target.value })} placeholder="0,00" aria-invalid={ongeldig('restwaarde')} />
                </span>
              </label>
              <div className="bh-veld bh-breed">
                <span className="bh-label" id="bh-act-termijn">
                  Afschrijven in
                </span>
                <div className="bh-termijn">
                  <div className="ag-segment bh-segment" role="radiogroup" aria-labelledby="bh-act-termijn">
                    {SNEL.map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={!f.anders && f.maanden === m} className={!f.anders && f.maanden === m ? 'is-aan' : ''} onClick={() => zet({ maanden: m, anders: '' })}>
                        {m / 12} jaar
                      </button>
                    ))}
                  </div>
                  <label className="bh-termijn-anders">
                    <span>of</span>
                    <input className="ag-veld" inputMode="numeric" value={f.anders} onChange={(e) => zet({ anders: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="48" aria-label="Eigen termijn in maanden" aria-invalid={ongeldig('looptijdMaanden')} />
                    <span>maanden</span>
                  </label>
                </div>
              </div>
              <label className="bh-veld bh-breed">
                <span className="bh-label">Notities</span>
                <textarea className="ag-veld" rows={2} value={f.notities} onChange={(e) => zet({ notities: e.target.value })} maxLength={2000} />
              </label>
            </fieldset>

            <div className="bh-uitkomst" aria-live="polite">
              <dl className="bh-uitkomst-cijfers">
                {voorbeeld ? (
                  <>
                    <div className="is-nadruk">
                      <dt>Per maand</dt>
                      <dd>{formatCenten(voorbeeld.m.gewoon)}</dd>
                    </div>
                    <div>
                      <dt>Per jaar</dt>
                      <dd>{formatCenten(voorbeeld.m.gewoon * 12)}</dd>
                    </div>
                    <div>
                      <dt>Termijn</dt>
                      <dd>{looptijdLabel(maanden)}</dd>
                    </div>
                    <div>
                      <dt>Laatste maand</dt>
                      <dd>{voorbeeld.einde ? `${voorbeeld.einde.slice(5, 7)}-${voorbeeld.einde.slice(0, 4)}` : '—'}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>Afschrijving</dt>
                    <dd className="bh-zacht">vul aanschafprijs en termijn in</dd>
                  </div>
                )}
              </dl>
              {voorbeeld && voorbeeld.m.laatste !== voorbeeld.m.gewoon && (
                <p className="bh-uitkomst-noot">De laatste maand is {formatCenten(voorbeeld.m.laatste)}, zodat de boekwaarde precies op de restwaarde uitkomt.</p>
              )}
              {voorbeeld?.hints.map((h) => (
                <p key={h.tekst} className={`bh-uitkomst-noot${h.soort === 'let_op' ? ' is-let-op' : ''}`}>
                  {h.tekst}
                </p>
              ))}
            </div>
            {fout && <p className="ag-fout">{fout}</p>}
          </div>

          <footer className="ag-paneel-voet">
            <span />
            <div className="ag-paneel-acties">
              <button type="button" className="db-knop" onClick={onSluit}>
                Annuleren
              </button>
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !f.omschrijving.trim()}>
                {bezig ? 'Bezig…' : activum ? 'Opslaan' : 'Activeren'}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </>
  );
}
