'use client';

import { useMemo, useState } from 'react';
import { formatCenten, naarCenten, centenNaarInvoer, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import type { Suggestie } from '@/lib/boekhouding/kern/afletteren';
import type { KoppelBron, Koppeling } from '@/lib/boekhouding/kern/bronnen';

export interface KoppelKandidaat {
  bron: KoppelBron;
  id: string;
  titel: string;
  sub: string;
  datum: Datum;
  open: Centen;
}

export interface KoppelInfo {
  bron: KoppelBron | null;
  koppelingen: Koppeling[];
  label: (k: Koppeling) => { titel: string; sub: string; bestaat: boolean };
  suggesties: Suggestie[];
  kandidaten: KoppelKandidaat[];
  /** Nog niet gekoppeld deel van de bankregel (richting document). */
  rest: Centen;
  /** Reden waarom (ont)koppelen niet kan (vergrendeld), of null. */
  slot: string | null;
}

// Afletteren in het zijpaneel: wat er al gekoppeld is (met ontkoppelen), de beste suggesties
// (één klik) en zelf een open factuur of bonnetje kiezen, eventueel met een deelbedrag.
export function KoppelSuggesties({
  info,
  onKoppel,
  onOntkoppel
}: {
  info: KoppelInfo;
  onKoppel: (bron: KoppelBron, bronId: string, bedrag?: Centen) => Promise<void>;
  onOntkoppel: (id: string) => Promise<void>;
}) {
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [zelf, setZelf] = useState(false);
  const [zoek, setZoek] = useState('');
  const [keuze, setKeuze] = useState<string>('');
  const [bedrag, setBedrag] = useState('');

  const docNaam = info.bron === 'factuur' ? 'factuur' : 'bonnetje';
  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return info.kandidaten
      .filter((k) => !q || `${k.titel} ${k.sub} ${formatCenten(k.open)}`.toLowerCase().includes(q))
      .slice(0, 50);
  }, [info.kandidaten, zoek]);

  if (!info.bron) return null;

  async function doe(sleutel: string, fn: () => Promise<void>) {
    setBezig(sleutel);
    setFout(null);
    try {
      await fn();
      setZelf(false);
      setKeuze('');
      setBedrag('');
    } catch (e) {
      setFout((e as Error).message);
    } finally {
      setBezig(null);
    }
  }

  const gekozen = info.kandidaten.find((k) => k.id === keuze);

  return (
    <section className="bh-koppel" aria-label="Afletteren">
      <p className="bh-label">{info.bron === 'factuur' ? 'Betaling van factuur' : 'Betaling van bonnetje of inkoopfactuur'}</p>

      {info.koppelingen.length > 0 && (
        <ul className="bh-koppel-lijst">
          {info.koppelingen.map((k) => {
            const l = info.label(k);
            return (
              <li key={k.id} className={`bh-koppel-item is-gekoppeld${l.bestaat ? '' : ' is-wees'}`}>
                <span className="bh-koppel-tekst">
                  <span className="bh-koppel-titel">
                    {l.titel}
                    {!l.bestaat && <span className="bh-pil is-let-op">bestaat niet meer</span>}
                  </span>
                  <span className="bh-koppel-sub">{l.sub}</span>
                </span>
                <span className="bh-koppel-bedrag">{formatCenten(k.bedrag)}</span>
                {!info.slot && (
                  <button type="button" className="ag-link-knop" disabled={bezig !== null} onClick={() => doe(k.id, () => onOntkoppel(k.id))}>
                    {bezig === k.id ? 'Bezig…' : 'Ontkoppelen'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {info.koppelingen.length > 0 && info.rest !== 0 && <p className="bh-koppel-noot">Nog {formatCenten(Math.abs(info.rest))} van deze bankregel niet gekoppeld.</p>}

      {info.slot ? (
        <p className="bh-koppel-noot">{info.slot}</p>
      ) : info.rest !== 0 ? (
        <>
          {info.suggesties.length > 0 && (
            <ul className="bh-koppel-lijst">
              {info.suggesties.map((s) => (
                <li key={s.bronId} className="bh-koppel-item">
                  <span className="bh-koppel-tekst">
                    <span className="bh-koppel-titel">
                      {s.titel}
                      <span className="bh-pil">{s.score >= 90 ? 'zeker' : 'waarschijnlijk'}</span>
                    </span>
                    <span className="bh-koppel-sub">
                      {s.sub} · {korteDatum(s.datum)} · open {formatCenten(s.open)}
                    </span>
                    <span className="bh-koppel-reden">{s.redenen.join(' · ')}</span>
                  </span>
                  <span className="bh-koppel-bedrag">{formatCenten(s.bedrag)}</span>
                  <button type="button" className="db-knop db-knop-primair bh-koppel-knop" disabled={bezig !== null} onClick={() => doe(s.bronId, () => onKoppel(s.bron, s.bronId, s.bedrag))}>
                    {bezig === s.bronId ? 'Bezig…' : 'Koppelen'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {info.suggesties.length === 0 && info.koppelingen.length === 0 && <p className="bh-koppel-noot">Geen passende open {docNaam} gevonden.</p>}

          {!zelf ? (
            <button type="button" className="ag-link-knop bh-koppel-zelf" onClick={() => setZelf(true)} disabled={info.kandidaten.length === 0}>
              {info.kandidaten.length ? `Zelf een open ${docNaam} kiezen` : `Er staat geen ${docNaam} open`}
            </button>
          ) : (
            <div className="bh-koppel-kies">
              <input className="ag-veld" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder={info.bron === 'factuur' ? 'Zoek op nummer, klant of bedrag' : 'Zoek op leverancier of bedrag'} autoFocus />
              <select
                className="ag-veld"
                value={keuze}
                onChange={(e) => {
                  setKeuze(e.target.value);
                  const k = info.kandidaten.find((x) => x.id === e.target.value);
                  if (k) setBedrag(centenNaarInvoer(Math.sign(info.rest) * Math.min(Math.abs(info.rest), Math.abs(k.open))));
                }}
                aria-label={`Kies een ${docNaam}`}
                size={Math.min(6, Math.max(2, lijst.length))}
              >
                {lijst.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.titel} · {k.sub} · {korteDatum(k.datum)} · open {formatCenten(k.open)}
                  </option>
                ))}
              </select>
              {gekozen && (
                <div className="bh-koppel-kies-voet">
                  <label className="bh-veld">
                    <span className="bh-label">Bedrag</span>
                    <input className="ag-veld" inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="db-knop db-knop-primair"
                    disabled={bezig !== null || naarCenten(bedrag) === null}
                    onClick={() => doe('zelf', () => onKoppel(gekozen.bron, gekozen.id, naarCenten(bedrag) ?? undefined))}
                  >
                    {bezig === 'zelf' ? 'Bezig…' : 'Koppelen'}
                  </button>
                  <button type="button" className="db-knop" onClick={() => setZelf(false)}>
                    Annuleren
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
      {fout && <p className="ag-fout">{fout}</p>}
    </section>
  );
}
