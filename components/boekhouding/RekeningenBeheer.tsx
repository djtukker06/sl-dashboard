'use client';

import { useState } from 'react';
import { centenNaarInvoer, formatCenten } from '@/lib/boekhouding/kern/geld';
import { korteDatum } from '@/lib/boekhouding/kern/periode';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';
import { formatIban, type ImportFormaat, type Rekening } from '@/lib/boekhouding/model';

const FORMATEN: { id: ImportFormaat; label: string }[] = [
  { id: 'regiobank', label: 'RegioBank (CSV)' },
  { id: 'revolut', label: 'Revolut (CSV)' },
  { id: 'generiek', label: 'Andere bank (CSV, kolommen kiezen)' }
];

interface Concept {
  id: string | null;
  naam: string;
  iban: string;
  importFormaat: ImportFormaat;
  beginsaldo: string;
  begindatum: string;
}

const leeg: Concept = { id: null, naam: '', iban: '', importFormaat: 'generiek', beginsaldo: '', begindatum: '' };

// Bankrekeningen beheren: standaardrekening kiezen (die staat voorgeselecteerd bij een nieuwe
// boeking), rekeningen toevoegen, gegevens en beginsaldo aanpassen en (de)activeren.
export function RekeningenBeheer({ rekeningen: begin }: { rekeningen: Rekening[] }) {
  const [lijst, setLijst] = useState(begin);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    if (!concept) return;
    setBezig('form');
    setFout(null);
    const body = {
      naam: concept.naam,
      iban: concept.iban.trim() || null,
      importFormaat: concept.importFormaat,
      beginsaldo: concept.beginsaldo.trim() || '0',
      begindatum: concept.begindatum || null
    };
    try {
      if (concept.id) {
        const { rekening } = await bkApi<{ rekening: Rekening }>('/api/boekhouding/instellingen/rekeningen', { method: 'PATCH', body: { id: concept.id, ...body } });
        setLijst((l) => l.map((r) => (r.id === rekening.id ? rekening : r)));
      } else {
        const { rekening } = await bkApi<{ rekening: Rekening }>('/api/boekhouding/instellingen/rekeningen', { method: 'POST', body });
        setLijst((l) => [...l, rekening]);
      }
      setConcept(null);
    } catch (err) {
      setFout((err as BkApiFout).message);
    } finally {
      setBezig(null);
    }
  }

  async function wijzig(r: Rekening, w: { standaard?: true; actief?: boolean }) {
    setBezig(r.id);
    setFout(null);
    try {
      const { rekening } = await bkApi<{ rekening: Rekening }>('/api/boekhouding/instellingen/rekeningen', { method: 'PATCH', body: { id: r.id, ...w } });
      setLijst((l) => l.map((x) => (x.id === rekening.id ? rekening : w.standaard ? { ...x, standaard: false } : x)));
    } catch (err) {
      setFout((err as BkApiFout).message);
    } finally {
      setBezig(null);
    }
  }

  return (
    <div className="bh-rekeningen">
      <ul className="bh-rek-lijst">
        {lijst.map((r) => (
          <li key={r.id} className={`bh-rek${r.actief ? '' : ' is-uit'}`}>
            <div className="bh-rek-hoofd">
              <p className="bh-rek-naam">
                {r.naam}
                {r.standaard && <span className="bh-pil">standaard</span>}
                {!r.actief && <span className="bh-pil is-zacht">niet actief</span>}
              </p>
              <p className="bh-rek-meta">
                {r.iban ? formatIban(r.iban) : 'Geen IBAN ingevuld'} · grootboek {r.grootboek} · {FORMATEN.find((f) => f.id === r.importFormaat)?.label}
              </p>
              <p className="bh-rek-meta">
                Beginsaldo {formatCenten(r.beginsaldo)}
                {r.begindatum ? ` op ${korteDatum(r.begindatum)}` : ''}
              </p>
            </div>
            <div className="bh-rek-acties">
              {!r.standaard && r.actief && (
                <button type="button" className="db-knop" onClick={() => wijzig(r, { standaard: true })} disabled={bezig !== null}>
                  Maak standaard
                </button>
              )}
              <button
                type="button"
                className="db-knop"
                onClick={() =>
                  setConcept({ id: r.id, naam: r.naam, iban: r.iban ? formatIban(r.iban) : '', importFormaat: r.importFormaat, beginsaldo: centenNaarInvoer(r.beginsaldo), begindatum: r.begindatum ?? '' })
                }
                disabled={bezig !== null}
              >
                Wijzigen
              </button>
              {!r.standaard && (
                <button type="button" className="ag-link-knop" onClick={() => wijzig(r, { actief: !r.actief })} disabled={bezig !== null}>
                  {r.actief ? 'Uitzetten' : 'Weer aanzetten'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {fout && <p className="ag-fout">{fout}</p>}

      {concept ? (
        <form className="bh-kaart bh-rek-form" onSubmit={opslaan}>
          <h3 className="bh-kaart-titel">{concept.id ? 'Rekening wijzigen' : 'Rekening toevoegen'}</h3>
          <div className="bh-rek-velden">
            <label className="bh-veld">
              <span className="bh-label">Naam</span>
              <input className="ag-veld" value={concept.naam} onChange={(e) => setConcept({ ...concept, naam: e.target.value })} placeholder="bv. Bunq" maxLength={80} required />
            </label>
            <label className="bh-veld">
              <span className="bh-label">IBAN (optioneel)</span>
              <input className="ag-veld" value={concept.iban} onChange={(e) => setConcept({ ...concept, iban: e.target.value })} placeholder="NL00 BANK 0123 4567 89" />
            </label>
            <label className="bh-veld">
              <span className="bh-label">Bankafschrift (CSV)</span>
              <select className="ag-veld" value={concept.importFormaat} onChange={(e) => setConcept({ ...concept, importFormaat: e.target.value as ImportFormaat })}>
                {FORMATEN.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="bh-veld">
              <span className="bh-label">Beginsaldo</span>
              <span className="bh-bedrag-invoer">
                <span aria-hidden="true">€</span>
                <input className="ag-veld" inputMode="decimal" value={concept.beginsaldo} onChange={(e) => setConcept({ ...concept, beginsaldo: e.target.value })} placeholder="0,00" />
              </span>
            </label>
            <label className="bh-veld">
              <span className="bh-label">Op datum</span>
              <input className="ag-veld" type="date" value={concept.begindatum} onChange={(e) => setConcept({ ...concept, begindatum: e.target.value })} />
            </label>
          </div>
          <p className="bh-kaart-sub">Het beginsaldo is het saldo volgens de bank op de startdatum van de administratie voor deze rekening.</p>
          <div className="bh-rek-form-voet">
            <button type="button" className="db-knop" onClick={() => setConcept(null)}>
              Annuleren
            </button>
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig !== null}>
              {bezig ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="db-knop" onClick={() => setConcept(leeg)} disabled={lijst.length >= 10}>
          + Rekening toevoegen
        </button>
      )}
    </div>
  );
}
