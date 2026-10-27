'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { BTW_LABELS, type BtwCode } from '@/lib/boekhouding/kern/btw';
import { korteDatum } from '@/lib/boekhouding/kern/periode';
import type { AfschriftFormaat, Kolommapping } from '@/lib/boekhouding/kern/bankimport';
import { SOORT_LABELS, type BoekingSoort, type Stamdata } from '@/lib/boekhouding/model';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';

type Status = 'nieuw' | 'dubbel' | 'vergrendeld' | 'buiten_bereik';

interface Voorbeeld {
  formaat: AfschriftFormaat;
  kolommen: string[];
  voorbeeld: string[][];
  mapping: Kolommapping | null;
  mappingNodig: boolean;
  ibanAnders: boolean;
  ibanBestand: string | null;
  overgeslagen: { rij: number; reden: string }[];
  telling: { nieuw: number; dubbel: number; vergrendeld: number; buitenBereik: number; overgeslagen: number };
  regels: {
    rij: number;
    datum: string;
    bedrag: number;
    omschrijving: string;
    tegenpartij: string | null;
    status: Status;
    reden: string | null;
    voorstel: { soort: BoekingSoort; btwCode: BtwCode; grootboek: string | null; btw: number; bron: string };
  }[];
}

const FORMAAT_LABEL: Record<AfschriftFormaat, string> = { regiobank: 'RegioBank (CSV)', revolut: 'Revolut (CSV)', generiek: 'Eigen kolomkeuze' };
const STATUS_LABEL: Record<Status, string> = { nieuw: 'nieuw', dubbel: 'al geïmporteerd', vergrendeld: 'vergrendeld', buiten_bereik: 'buiten bereik' };
const BRON_LABEL: Record<string, string> = {
  eigen_rekening: 'eigen rekening',
  geschiedenis: 'zoals eerder',
  belastingdienst: 'Belastingdienst',
  bankkosten: 'bankkosten',
  standaard: 'standaard'
};

async function leesBestand(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Oudere bankexports zijn soms Windows-1252 (é, ë, €).
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// Bankafschrift importeren in drie stappen: bestand kiezen → controleren (nieuw/dubbel, voorstel
// voor soort, btw en categorie; bij een onbekend formaat de kolommen kiezen) → importeren. De
// regels komen binnen als "te verwerken"; koppelen en controleren gebeurt in Bank & boekingen.
export function ImportWizard({ stam, voorbeelden }: { stam: Stamdata; voorbeelden: { regiobank: string; revolut: string } | null }) {
  const rekeningen = stam.rekeningen.filter((r) => r.actief);
  const [rekeningId, setRekeningId] = useState(() => (rekeningen.find((r) => r.standaard) ?? rekeningen[0])?.id ?? '');
  const [bestand, setBestand] = useState<{ naam: string; tekst: string } | null>(null);
  const [formaat, setFormaat] = useState<'' | AfschriftFormaat>('');
  const [mapping, setMapping] = useState<Kolommapping | null>(null);
  const [onthoud, setOnthoud] = useState(true);
  const [vb, setVb] = useState<Voorbeeld | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [klaar, setKlaar] = useState<{ nieuw: number; dubbel: number; vergrendeld: number; overgeslagen: number } | null>(null);
  const invoer = useRef<HTMLInputElement>(null);
  const gbNaam = new Map(stam.grootboek.map((g) => [g.code, g.naam]));

  async function controleer(b: { naam: string; tekst: string }, opties: { rekeningId?: string; formaat?: '' | AfschriftFormaat; mapping?: Kolommapping | null } = {}) {
    setBezig(true);
    setFout(null);
    setKlaar(null);
    try {
      const f = opties.formaat ?? formaat;
      const m = opties.mapping !== undefined ? opties.mapping : mapping;
      const r = await bkApi<Voorbeeld>('/api/boekhouding/import', {
        method: 'POST',
        body: { rekeningId: opties.rekeningId ?? rekeningId, bestandsnaam: b.naam, tekst: b.tekst, formaat: f || undefined, mapping: f === 'generiek' || (!f && m) ? m : undefined }
      });
      setVb(r);
      if (r.mapping && (r.formaat === 'generiek' || r.mappingNodig)) setMapping(r.mapping);
    } catch (e) {
      setFout((e as BkApiFout).message);
      setVb(null);
    } finally {
      setBezig(false);
    }
  }

  async function kies(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) {
      setFout('Dit bestand is te groot (maximaal 2 MB). Exporteer een kortere periode.');
      return;
    }
    const b = { naam: f.name, tekst: await leesBestand(f) };
    setBestand(b);
    setFormaat('');
    setMapping(null);
    await controleer(b, { formaat: '', mapping: null });
  }

  async function voorbeeld(soort: 'regiobank' | 'revolut') {
    if (!voorbeelden) return;
    const rek = rekeningen.find((r) => r.importFormaat === soort) ?? rekeningen[0];
    const b = { naam: soort === 'regiobank' ? 'voorbeeld-regiobank.csv' : 'voorbeeld-revolut.csv', tekst: voorbeelden[soort] };
    if (rek) setRekeningId(rek.id);
    setBestand(b);
    setFormaat('');
    setMapping(null);
    await controleer(b, { rekeningId: rek?.id, formaat: '', mapping: null });
  }

  async function importeer() {
    if (!bestand || !vb) return;
    setBezig(true);
    setFout(null);
    try {
      const r = await bkApi<{ nieuw: number; dubbel: number; vergrendeld: number; overgeslagen: number }>('/api/boekhouding/import', {
        method: 'POST',
        body: {
          rekeningId,
          bestandsnaam: bestand.naam,
          tekst: bestand.tekst,
          formaat: formaat || undefined,
          mapping: vb.formaat === 'generiek' ? mapping : undefined,
          bevestig: true,
          onthoudMapping: vb.formaat === 'generiek' && onthoud
        }
      });
      setKlaar(r);
      setVb(null);
    } catch (e) {
      setFout((e as BkApiFout).message);
    } finally {
      setBezig(false);
    }
  }

  function opnieuw() {
    setBestand(null);
    setVb(null);
    setKlaar(null);
    setFout(null);
    setFormaat('');
    setMapping(null);
    if (invoer.current) invoer.current.value = '';
  }

  const kolomKeuze = (label: string, waarde: number | null, zet: (v: number | null) => void, optioneel = true) => (
    <label className="bh-veld">
      <span className="bh-label">{label}</span>
      <select className="ag-veld" value={waarde === null ? '' : String(waarde)} onChange={(e) => zet(e.target.value === '' ? null : Number(e.target.value))}>
        {optioneel && <option value="">—</option>}
        {(vb?.kolommen ?? []).map((k, i) => (
          <option key={i} value={i}>
            {k}
            {vb?.voorbeeld[0]?.[i] ? ` — ${vb.voorbeeld[0][i].slice(0, 28)}` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  const rekNaam = rekeningen.find((r) => r.id === rekeningId)?.naam ?? '';

  return (
    <div className="bh-inhoud bh-import">
      {/* ---------- stap 1 ---------- */}
      <section className="bh-kaart" aria-labelledby="bh-imp-1">
        <header className="bh-kaart-kop">
          <h2 id="bh-imp-1" className="bh-kaart-titel">
            <span className="bh-stap">1</span> Afschrift kiezen
          </h2>
          <p className="bh-kaart-sub">Exporteer in je bankomgeving de bij- en afschrijvingen als CSV en kies het bestand. Hetzelfde bestand twee keer importeren kan geen kwaad: regels die er al zijn worden overgeslagen.</p>
        </header>
        <div className="bh-import-kies">
          <label className="bh-veld">
            <span className="bh-label">Rekening</span>
            <select
              className="ag-veld"
              value={rekeningId}
              onChange={(e) => {
                setRekeningId(e.target.value);
                if (bestand) void controleer(bestand, { rekeningId: e.target.value });
              }}
            >
              {rekeningen.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.naam}
                  {r.standaard ? ' (standaard)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="bh-import-bestand">
            <input ref={invoer} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void kies(e.target.files?.[0])} />
            <span className="db-knop db-knop-primair">{bestand ? 'Ander bestand kiezen' : 'CSV-bestand kiezen'}</span>
            <span className="bh-import-naam">{bestand ? bestand.naam : 'RegioBank of Revolut wordt automatisch herkend'}</span>
          </label>
          {voorbeelden && (
            <div className="bh-import-voorbeeld">
              <span className="bh-label">Of probeer</span>
              <button type="button" className="db-knop" onClick={() => void voorbeeld('regiobank')} disabled={bezig}>
                Voorbeeld RegioBank
              </button>
              <button type="button" className="db-knop" onClick={() => void voorbeeld('revolut')} disabled={bezig}>
                Voorbeeld Revolut
              </button>
            </div>
          )}
        </div>
        {fout && <p className="ag-fout">{fout}</p>}
      </section>

      {bezig && !vb && <p className="bh-melding is-ok">Bezig met lezen…</p>}

      {/* ---------- stap 2 ---------- */}
      {vb && bestand && (
        <section className="bh-kaart" aria-labelledby="bh-imp-2">
          <header className="bh-kaart-kop bh-import-kop">
            <div>
              <h2 id="bh-imp-2" className="bh-kaart-titel">
                <span className="bh-stap">2</span> Controleren
              </h2>
              <p className="bh-kaart-sub">
                {bestand.naam} · herkend als <strong>{FORMAAT_LABEL[vb.formaat]}</strong> · naar {rekNaam}
              </p>
            </div>
            <label className="bh-veld bh-import-formaat">
              <span className="bh-label">Formaat</span>
              <select
                className="ag-veld"
                value={formaat}
                onChange={(e) => {
                  const f = e.target.value as '' | AfschriftFormaat;
                  setFormaat(f);
                  void controleer(bestand, { formaat: f, mapping: f === 'generiek' ? mapping ?? vb.mapping : null });
                }}
              >
                <option value="">Automatisch</option>
                <option value="regiobank">RegioBank</option>
                <option value="revolut">Revolut</option>
                <option value="generiek">Zelf kolommen kiezen</option>
              </select>
            </label>
          </header>

          <ul className="bh-import-telling">
            <li className="is-nieuw">
              <strong>{vb.telling.nieuw}</strong> nieuw
            </li>
            <li>
              <strong>{vb.telling.dubbel}</strong> al geïmporteerd
            </li>
            {vb.telling.vergrendeld > 0 && (
              <li className="is-let-op">
                <strong>{vb.telling.vergrendeld}</strong> in een vergrendeld kwartaal
              </li>
            )}
            {vb.telling.overgeslagen + vb.telling.buitenBereik > 0 && (
              <li>
                <strong>{vb.telling.overgeslagen + vb.telling.buitenBereik}</strong> overgeslagen
              </li>
            )}
          </ul>
          {vb.ibanAnders && (
            <p className="bh-uitkomst-noot is-let-op">
              Let op: dit afschrift hoort bij {vb.ibanBestand}, niet bij de gekozen rekening {rekNaam}. Kies de juiste rekening.
            </p>
          )}

          {(vb.formaat === 'generiek' || vb.mappingNodig) && mapping && (
            <div className="bh-mapping">
              <p className="bh-kaart-sub">
                {vb.mappingNodig ? 'Dit formaat kennen we nog niet. ' : ''}Kies welke kolom wat bevat; de keuze wordt per rekening onthouden.
              </p>
              <div className="bh-mapping-velden">
                <label className="bh-veld-schakel">
                  <input type="checkbox" checked={mapping.heeftKop} onChange={(e) => setMapping({ ...mapping, heeftKop: e.target.checked })} />
                  <span>Eerste regel is een kopregel</span>
                </label>
                {kolomKeuze('Datum', mapping.datum, (v) => setMapping({ ...mapping, datum: v ?? 0 }), false)}
                {kolomKeuze('Bedrag', mapping.bedrag, (v) => setMapping({ ...mapping, bedrag: v }))}
                {kolomKeuze('Af/Bij (optioneel)', mapping.afBij, (v) => setMapping({ ...mapping, afBij: v }))}
                {kolomKeuze('Omschrijving', mapping.omschrijving[0] ?? null, (v) => setMapping({ ...mapping, omschrijving: v === null ? [] : [v] }))}
                {kolomKeuze('Tegenpartij', mapping.tegenpartij, (v) => setMapping({ ...mapping, tegenpartij: v }))}
                {kolomKeuze('Tegenrekening', mapping.tegenrekening, (v) => setMapping({ ...mapping, tegenrekening: v }))}
                {kolomKeuze('Uniek kenmerk (optioneel)', mapping.sleutel, (v) => setMapping({ ...mapping, sleutel: v }))}
              </div>
              <div className="bh-mapping-voet">
                <label className="bh-veld-schakel">
                  <input type="checkbox" checked={onthoud} onChange={(e) => setOnthoud(e.target.checked)} />
                  <span>Onthouden voor {rekNaam}</span>
                </label>
                <button type="button" className="db-knop" onClick={() => void controleer(bestand, { formaat: 'generiek', mapping })} disabled={bezig}>
                  Opnieuw lezen
                </button>
              </div>
            </div>
          )}

          {vb.regels.length > 0 && (
            <div className="bh-tabel bh-import-tabel" role="table" aria-label="Regels uit het afschrift">
              <div className="bh-tr bh-th" role="row">
                <span role="columnheader">Datum</span>
                <span role="columnheader">Omschrijving</span>
                <span role="columnheader">Voorstel</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className="bh-r">
                  Bedrag
                </span>
              </div>
              {vb.regels.map((r, i) => (
                <div key={`${r.rij}-${i}`} role="row" className={`bh-tr bh-rij is-${r.status}`}>
                  <span role="cell" className="bh-rij-datum">
                    {korteDatum(r.datum)}
                  </span>
                  <span role="cell" className="bh-rij-hoofd">
                    <span className="bh-rij-titel">{r.omschrijving}</span>
                    <span className="bh-rij-meta">{r.tegenpartij && r.tegenpartij !== r.omschrijving ? r.tegenpartij : `regel ${r.rij}`}</span>
                  </span>
                  <span role="cell" className="bh-import-voorstel">
                    <span>
                      {SOORT_LABELS[r.voorstel.soort].kort}
                      {r.voorstel.grootboek ? ` · ${gbNaam.get(r.voorstel.grootboek) ?? r.voorstel.grootboek}` : ''}
                    </span>
                    <span className="bh-rij-meta">
                      {r.voorstel.soort === 'uitgave' || r.voorstel.soort === 'inkomst' ? BTW_LABELS[r.voorstel.btwCode].kort : 'geen btw'} · {BRON_LABEL[r.voorstel.bron] ?? ''}
                    </span>
                  </span>
                  <span role="cell">
                    <span className={`bh-pil is-${r.status === 'nieuw' ? 'nieuw' : r.status === 'vergrendeld' ? 'let-op' : 'zacht'}`} title={r.reden ?? undefined}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </span>
                  <span role="cell" className={`bh-r bh-rij-bedrag${r.bedrag > 0 ? ' is-bij' : ''}`}>
                    {r.bedrag > 0 ? '+' : '−'} {formatCenten(Math.abs(r.bedrag))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {vb.overgeslagen.length > 0 && (
            <details className="bh-import-over">
              <summary>{vb.overgeslagen.length} regels overgeslagen</summary>
              <ul>
                {vb.overgeslagen.map((o, i) => (
                  <li key={i}>
                    Regel {o.rij}: {o.reden}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <footer className="bh-invoer-voet">
            <p className="bh-kaart-sub">Nieuwe regels komen binnen als “te verwerken”. Daarna koppel je ze aan facturen en bonnetjes of controleer je soort, btw en categorie.</p>
            <button type="button" className="db-knop db-knop-primair" onClick={() => void importeer()} disabled={bezig || vb.telling.nieuw === 0 || vb.mappingNodig}>
              {bezig ? 'Bezig…' : vb.telling.nieuw === 0 ? 'Niets nieuws' : `${vb.telling.nieuw} ${vb.telling.nieuw === 1 ? 'regel' : 'regels'} importeren`}
            </button>
          </footer>
        </section>
      )}

      {/* ---------- stap 3 ---------- */}
      {klaar && (
        <section className="bh-kaart bh-import-klaar" aria-labelledby="bh-imp-3" role="status">
          <h2 id="bh-imp-3" className="bh-kaart-titel">
            <span className="bh-stap">3</span> {klaar.nieuw ? `${klaar.nieuw} ${klaar.nieuw === 1 ? 'regel' : 'regels'} geïmporteerd` : 'Niets nieuws geïmporteerd'}
          </h2>
          <p className="bh-kaart-sub">
            {klaar.dubbel ? `${klaar.dubbel} al eerder geïmporteerd en overgeslagen. ` : ''}
            {klaar.vergrendeld ? `${klaar.vergrendeld} in een vergrendeld kwartaal niet toegevoegd. ` : ''}
            {klaar.overgeslagen ? `${klaar.overgeslagen} regels overgeslagen. ` : ''}
          </p>
          <div className="bh-tegel-voet">
            <Link className="db-knop db-knop-primair" href="/boekhouding/bank?status=te_verwerken&jaar=alle">
              Te verwerken regels bekijken
            </Link>
            <button type="button" className="db-knop" onClick={opnieuw}>
              Nog een afschrift
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
