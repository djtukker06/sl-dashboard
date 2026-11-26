'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bedrijf } from '@/lib/config';
import { formatEuro } from '@/lib/format';
import { akkoordStand, datumKort, periodeBereik, periodeLabel, ritme, subtotaal } from '@/lib/invoice/terugkerend-kern';
import type { TerugkerendDto } from '@/lib/invoice/terugkerend-beheer';
import { FactuurInzien } from './FactuurInzien';

// Overzicht van de terugkerende facturen (/facturen/terugkerend): per sjabloon wat, voor wie,
// hoe vaak, wanneer de volgende komt en waar hij heen gaat, met pauzeren/hervatten, nu
// factureren en bewerken. Onder elk sjabloon de facturen die hij maakte, met per factuur of
// hij verstuurd is (en opnieuw versturen). Bovenaan het controlescherm voor akkoord vooraf.
export function TerugkerendLijst({ sjablonen, vandaag }: { sjablonen: TerugkerendDto[]; vandaag: string }) {
  if (!sjablonen.length) {
    return (
      <div className="leeg-melding tk-leeg">
        <p>Nog geen terugkerende facturen.</p>
        <p>
          Maak er een voor bijvoorbeeld een onderhoudspakket: kies de klant, het bedrag en de dag, en hij wordt elke maand vanzelf aangemaakt en
          verstuurd.
        </p>
        <Link href="/facturen/nieuwe-factuur?soort=terugkerend" className="db-knop db-knop-primair">
          + Nieuwe terugkerende factuur
        </Link>
      </div>
    );
  }
  return (
    <>
      <Controle sjablonen={sjablonen} vandaag={vandaag} />
      <div className="tk-lijst">
        {sjablonen.map((s) => (
          <Sjabloon key={s.id} s={s} vandaag={vandaag} />
        ))}
      </div>
    </>
  );
}

const inclBtw = (s: TerugkerendDto) => {
  const excl = subtotaal(s.regels);
  return s.btwVerlegd ? excl : excl + Math.round(excl * bedrijf.btwPercentage) / 100;
};

/**
 * Akkoord vooraf (0038), op één plek: de terugkerende facturen die binnen een week verstuurd
 * worden en nog akkoord nodig hebben (met voorbeeld-PDF, per stuk of alles in één keer), en
 * facturen die al gemaakt zijn maar zonder akkoord nog niet verstuurd.
 */
function Controle({ sjablonen, vandaag }: { sjablonen: TerugkerendDto[]; vandaag: string }) {
  const router = useRouter();
  const [bezig, setBezig] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ fout: boolean; tekst: string } | null>(null);

  const stand = (s: TerugkerendDto) =>
    akkoordStand(
      { actief: s.actief, versturen: s.versturen, akkoord_vereist: s.akkoordVereist, akkoord_periode: s.akkoordPeriode, volgende_datum: s.volgendeDatum },
      vandaag
    );
  const gevraagd = sjablonen.filter((s) => stand(s) === 'gevraagd');
  const wachtend = sjablonen.flatMap((s) => s.facturen.filter((f) => f.wachtOpAkkoord).map((f) => ({ s, f })));
  if (!gevraagd.length && !wachtend.length) return null;

  async function post(sleutel: string, url: string, body: unknown, gelukt: string) {
    setBezig(sleutel);
    setMelding(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMelding({ fout: true, tekst: data.error || 'Dat is mislukt.' });
      else {
        setMelding({ fout: false, tekst: gelukt });
        router.refresh();
      }
    } catch {
      setMelding({ fout: true, tekst: 'Geen verbinding met de server.' });
    } finally {
      setBezig(null);
    }
  }

  return (
    <section className="card tk-controle" id="akkoord">
      <div className="tk-controle-kop">
        <h2>Wacht op jouw akkoord</h2>
        {gevraagd.length > 1 && (
          <button
            type="button"
            className="db-knop db-knop-primair"
            disabled={bezig !== null}
            onClick={() => post('alles', '/api/terugkerend/akkoord', { ids: gevraagd.map((s) => s.id) }, `${gevraagd.length} facturen goedgekeurd.`)}
          >
            {bezig === 'alles' ? 'Bezig…' : `Alles akkoord (${gevraagd.length})`}
          </button>
        )}
      </div>
      {melding && <p className={melding.fout ? 'foutmelding tk-fout' : 'tk-ok'}>{melding.tekst}</p>}
      {gevraagd.length > 0 && (
        <ul className="tk-controle-lijst">
          {gevraagd.map((s) => (
            <li key={s.id}>
              <div className="tk-controle-tekst">
                <strong>{s.naam}</strong> · {s.klantNaam}
                <span className="tk-sub">
                  {datumKort(s.volgendeDatum)} · {periodeBereik(s.volgendeDatum, s.interval, s.dag)} · € {formatEuro(inclBtw(s))} · naar {s.emailAan}
                </span>
              </div>
              <FactuurInzien id={s.id} naam={s.naam} />
              <button type="button" className="db-knop db-knop-primair" disabled={bezig !== null} onClick={() => post(s.id, '/api/terugkerend/akkoord', { ids: [s.id] }, `"${s.naam}" goedgekeurd.`)}>
                {bezig === s.id ? 'Bezig…' : 'Akkoord'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {wachtend.length > 0 && (
        <>
          <p className="tk-controle-sub">Al aangemaakt, maar nog niet verstuurd omdat er geen akkoord was:</p>
          <ul className="tk-controle-lijst">
            {wachtend.map(({ s, f }) => (
              <li key={f.id}>
                <div className="tk-controle-tekst">
                  <strong>Factuur {f.nummer}</strong> · {s.klantNaam}
                  <span className="tk-sub">
                    {f.periode ? periodeLabel(f.periode, s.interval) : datumKort(f.datum)} · € {formatEuro(f.totaal)} · naar {s.emailAan}
                  </span>
                </div>
                <a className="db-knop" href={`/api/invoices/${f.id}/pdf`} target="_blank" rel="noreferrer">
                  Bekijken
                </a>
                <button
                  type="button"
                  className="db-knop db-knop-primair"
                  disabled={bezig !== null}
                  onClick={() => post(f.id, `/api/terugkerend/${s.id}/versturen`, { factuurId: f.id }, `Factuur ${f.nummer} is verstuurd.`)}
                >
                  {bezig === f.id ? 'Bezig…' : 'Versturen'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Sjabloon({ s, vandaag }: { s: TerugkerendDto; vandaag: string }) {
  const router = useRouter();
  const [bezig, setBezig] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ fout: boolean; tekst: string } | null>(null);
  const [alles, setAlles] = useState(false);

  const excl = subtotaal(s.regels);
  const incl = s.btwVerlegd ? excl : excl + Math.round(excl * bedrijf.btwPercentage) / 100;
  const voorbij = s.eindDatum !== null && s.volgendeDatum > s.eindDatum;
  const status = !s.actief ? (voorbij ? 'Afgelopen' : 'Gepauzeerd') : s.laatsteFout ? 'Let op' : 'Actief';
  const akkoord = akkoordStand(
    { actief: s.actief, versturen: s.versturen, akkoord_vereist: s.akkoordVereist, akkoord_periode: s.akkoordPeriode, volgende_datum: s.volgendeDatum },
    vandaag
  );

  async function doe(sleutel: string, url: string, body: unknown, gelukt: (data: Record<string, unknown>) => string) {
    setBezig(sleutel);
    setMelding(null);
    try {
      const res = await fetch(url, { method: sleutel === 'verwijderen' ? 'DELETE' : sleutel === 'pauze' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMelding({ fout: true, tekst: data.error || 'Dat is mislukt.' });
      else {
        setMelding({ fout: false, tekst: gelukt(data) });
        router.refresh();
      }
    } catch {
      setMelding({ fout: true, tekst: 'Geen verbinding met de server.' });
    } finally {
      setBezig(null);
    }
  }

  const nuFactureren = () => {
    const wat = `de factuur voor ${periodeLabel(s.volgendeDatum, s.interval)}`;
    if (!confirm(`Nu ${wat} aanmaken${s.versturen ? ` en versturen naar ${s.emailAan}` : ''}? De volgende staat daarna gepland op de normale dag.`)) return;
    void doe('nu', `/api/terugkerend/${s.id}/nu`, null, (d) =>
      d.status === 'versturen_mislukt'
        ? `Factuur ${d.factuurnummer} is aangemaakt, maar versturen is mislukt: ${d.fout}`
        : `Factuur ${d.factuurnummer} is aangemaakt${d.status === 'verstuurd' ? ' en verstuurd' : ''}.`
    );
  };

  const verwijderen = () => {
    if (!confirm(`"${s.naam}" stoppen en verwijderen? De facturen die al gemaakt zijn, blijven gewoon bestaan.`)) return;
    void doe('verwijderen', `/api/terugkerend/${s.id}`, null, () => 'Verwijderd.');
  };

  const facturen = alles ? s.facturen : s.facturen.slice(0, 3);

  return (
    <article className={`card tk-kaart${s.actief ? '' : ' is-uit'}`}>
      <div className="tk-kop">
        <div>
          <h3 className="tk-naam">
            {s.naam} <span className={`soort-label tk-status is-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>
            {akkoord === 'gevraagd' && <span className="soort-label tk-status is-let-op">Wacht op akkoord</span>}
            {akkoord === 'akkoord' && <span className="soort-label tk-status is-actief">Akkoord voor {datumKort(s.volgendeDatum)}</span>}
          </h3>
          <div className="tk-klant">{s.klantNaam}</div>
        </div>
        <div className="tk-prijs">
          <strong>€ {formatEuro(incl)}</strong>
          <span>{s.btwVerlegd ? 'btw verlegd' : `€ ${formatEuro(excl)} excl. btw`}</span>
        </div>
      </div>

      <dl className="tk-feiten">
        <div>
          <dt>Ritme</dt>
          <dd>{ritme(s.interval, s.dag)}</dd>
        </div>
        <div>
          <dt>Volgende</dt>
          <dd>{s.actief ? `${datumKort(s.volgendeDatum)} · ${periodeLabel(s.volgendeDatum, s.interval)}` : '—'}</dd>
        </div>
        <div>
          <dt>Versturen</dt>
          <dd>{s.versturen ? `Naar ${s.emailAan}${s.akkoordVereist ? ', na akkoord' : ''}` : 'Alleen aanmaken'}</dd>
        </div>
        {s.eindDatum && (
          <div>
            <dt>Stopt na</dt>
            <dd>{datumKort(s.eindDatum)}</dd>
          </div>
        )}
      </dl>

      {s.laatsteFout && <p className="foutmelding tk-fout">{s.laatsteFout}</p>}
      {melding && <p className={melding.fout ? 'foutmelding tk-fout' : 'tk-ok'}>{melding.tekst}</p>}

      <div className="tk-acties">
        <Link href={`/facturen/terugkerend/${s.id}`} className="db-knop">
          Bewerken
        </Link>
        {s.actief && <FactuurInzien id={s.id} naam={s.naam} />}
        {(akkoord === 'gevraagd' || akkoord === 'later') && (
          <button type="button" className="db-knop db-knop-primair" disabled={bezig !== null} onClick={() => doe('akkoord', '/api/terugkerend/akkoord', { ids: [s.id] }, () => `Akkoord voor ${datumKort(s.volgendeDatum)}.`)}>
            {bezig === 'akkoord' ? 'Bezig…' : 'Akkoord geven'}
          </button>
        )}
        {s.actief ? (
          <>
            <button type="button" className="db-knop" disabled={bezig !== null} onClick={() => doe('pauze', `/api/terugkerend/${s.id}`, { actief: false }, () => 'Gepauzeerd: er worden geen facturen meer gemaakt tot je hem hervat.')}>
              {bezig === 'pauze' ? 'Bezig…' : 'Pauzeren'}
            </button>
            <button type="button" className="db-knop" disabled={bezig !== null} onClick={nuFactureren}>
              {bezig === 'nu' ? 'Bezig met aanmaken…' : 'Nu factureren'}
            </button>
          </>
        ) : (
          <button type="button" className="db-knop db-knop-primair" disabled={bezig !== null} onClick={() => doe('pauze', `/api/terugkerend/${s.id}`, { actief: true }, () => 'Hervat.')}>
            {bezig === 'pauze' ? 'Bezig…' : 'Hervatten'}
          </button>
        )}
        <button type="button" className="ag-link-knop tk-verwijder" disabled={bezig !== null} onClick={verwijderen}>
          Verwijderen
        </button>
      </div>

      {s.facturen.length > 0 && (
        <div className="tk-facturen">
          <div className="tk-facturen-kop">Gemaakte facturen</div>
          <ul>
            {facturen.map((f) => (
              <li key={f.id}>
                <a href={`/api/invoices/${f.id}/pdf`} target="_blank" rel="noreferrer">
                  {f.nummer}
                </a>
                <span>{f.periode ? periodeLabel(f.periode, s.interval) : datumKort(f.datum)}</span>
                <span className="tk-bedrag-klein">€ {formatEuro(f.totaal)}</span>
                <span className={f.verzondenOp ? 'tk-verzonden' : f.wachtOpAkkoord ? 'tk-wacht' : 'tk-niet-verzonden'} title={f.verzondenAan ?? undefined}>
                  {f.verzondenOp ? `Verstuurd ${datumKort(f.verzondenOp.slice(0, 10))}` : f.wachtOpAkkoord ? 'Wacht op akkoord' : 'Niet verstuurd'}
                </span>
                {s.emailAan && s.mailboxId && (
                  <button
                    type="button"
                    className="ag-link-knop"
                    disabled={bezig !== null}
                    onClick={() => {
                      if (!confirm(`Factuur ${f.nummer} ${f.verzondenOp ? 'opnieuw ' : ''}versturen naar ${s.emailAan}?`)) return;
                      void doe(`mail-${f.id}`, `/api/terugkerend/${s.id}/versturen`, { factuurId: f.id }, () => `Factuur ${f.nummer} is verstuurd.`);
                    }}
                  >
                    {bezig === `mail-${f.id}` ? 'Bezig…' : f.verzondenOp ? 'Opnieuw versturen' : 'Versturen'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {s.facturen.length > 3 && (
            <button type="button" className="ag-link-knop" onClick={() => setAlles(!alles)}>
              {alles ? 'Minder tonen' : `Alle ${s.facturen.length} tonen`}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
