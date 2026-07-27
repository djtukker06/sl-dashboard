'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClientCombobox } from './ClientCombobox';

interface RegelInvoer {
  beschrijving: string;
  midden: string;
  totaal: string;
  teltMeeInOmzet: boolean;
}

const LEGE_REGEL: RegelInvoer = { beschrijving: '', midden: '', totaal: '', teltMeeInOmzet: true };

export function InvoiceForm({
  volgendFactuurnummer,
  vandaag
}: {
  volgendFactuurnummer: string;
  vandaag: string;
}) {
  const router = useRouter();

  const [factuurnummer, setFactuurnummer] = useState(volgendFactuurnummer);
  const [datum, setDatum] = useState(vandaag);
  const [klantBedrijfsnaam, setKlantBedrijfsnaam] = useState('');
  const [klantTav, setKlantTav] = useState('');
  const [klantAdres, setKlantAdres] = useState('');
  const [klantPostcode, setKlantPostcode] = useState('');
  const [middenKolomLabel, setMiddenKolomLabel] = useState('');
  const [regels, setRegels] = useState<RegelInvoer[]>([{ ...LEGE_REGEL }]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  function wijzigRegel(index: number, veld: keyof RegelInvoer, waarde: string | boolean) {
    setRegels((prev) => prev.map((r, i) => (i === index ? { ...r, [veld]: waarde } : r)));
  }

  function verwijderRegel(index: number) {
    setRegels((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);

    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        factuurnummer,
        datum,
        klantBedrijfsnaam,
        klantTav,
        klantAdres,
        klantPostcode,
        middenKolomLabel,
        regels
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFout(data.error || 'Er ging iets mis bij het aanmaken van de factuur.');
      setBezig(false);
      return;
    }

    const data = await res.json();
    router.push(`/api/invoices/${data.id}/pdf`);
  }

  return (
    <form onSubmit={handleSubmit}>
      {fout && <div className="foutmelding">{fout}</div>}

      <section className="card">
        <h2>Factuurgegevens</h2>
        <div className="grid-2">
          <label className="factuurnummer-input">
            Factuurnummer (formaat JJ-NNN)
            <input
              type="text"
              required
              pattern="\d{2}-\d{3}"
              title="Formaat: JJ-NNN, bijvoorbeeld 26-009"
              value={factuurnummer}
              onChange={(e) => setFactuurnummer(e.target.value)}
            />
          </label>
          <label>
            Factuurdatum
            <input
              type="date"
              required
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
        </div>
        <p className="veld-hint">
          Allebei automatisch ingevuld — pas ze aan als het anders moet, bijvoorbeeld bij
          het invoeren van een oudere factuur. Het jaartal in het nummer moet gelijk zijn
          aan het jaar van de datum.
        </p>
      </section>

      <section className="card">
        <h2>Klantgegevens</h2>
        <div className="grid-2">
          <ClientCombobox
            value={klantBedrijfsnaam}
            onChange={setKlantBedrijfsnaam}
            onSelectClient={(klant) => {
              setKlantBedrijfsnaam(klant.company_name);
              setKlantTav(klant.contact_name || '');
              setKlantAdres(klant.address || '');
              setKlantPostcode(klant.postal_code || '');
            }}
          />
          <label>
            T.a.v. (naam eigenaar/contactpersoon)
            <input
              type="text"
              required
              value={klantTav}
              onChange={(e) => setKlantTav(e.target.value)}
            />
          </label>
          <label>
            Adres (straat + huisnummer, plaats)
            <input
              type="text"
              required
              value={klantAdres}
              onChange={(e) => setKlantAdres(e.target.value)}
            />
          </label>
          <label>
            Postcode
            <input
              type="text"
              required
              value={klantPostcode}
              onChange={(e) => setKlantPostcode(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Factuurregels</h2>
        <label className="mid-label-input">
          Naam van de middelste kolom (optioneel, bijv. &quot;Periode&quot; of &quot;Aantal&quot;)
          <input
            type="text"
            value={middenKolomLabel}
            onChange={(e) => setMiddenKolomLabel(e.target.value)}
          />
        </label>

        <table className="regels-table">
          <thead>
            <tr>
              <th>Beschrijving</th>
              <th className="mid-col">Periode / aantal (optioneel)</th>
              <th>Totaal (&euro;)</th>
              <th className="omzet-col" title="Alleen voor je eigen omzetcijfer — dit komt niet op de factuur">
                Omzet
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    required
                    value={regel.beschrijving}
                    onChange={(e) => wijzigRegel(i, 'beschrijving', e.target.value)}
                  />
                </td>
                <td className="mid-col">
                  <input
                    type="text"
                    value={regel.midden}
                    onChange={(e) => wijzigRegel(i, 'midden', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    required
                    inputMode="decimal"
                    value={regel.totaal}
                    onChange={(e) => wijzigRegel(i, 'totaal', e.target.value)}
                  />
                </td>
                <td className="omzet-col">
                  <input
                    type="checkbox"
                    checked={regel.teltMeeInOmzet}
                    title={
                      regel.teltMeeInOmzet
                        ? 'Telt mee in je omzetcijfer'
                        : 'Telt niet mee in je omzetcijfer'
                    }
                    onChange={(e) => wijzigRegel(i, 'teltMeeInOmzet', e.target.checked)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="verwijder-regel"
                    title="Regel verwijderen"
                    onClick={() => verwijderRegel(i)}
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="btn-secundair"
          onClick={() => setRegels((prev) => [...prev, { ...LEGE_REGEL }])}
        >
          + Regel toevoegen
        </button>

        <p className="veld-hint">
          Het vinkje <strong>Omzet</strong> is alleen voor jezelf: het bepaalt of een regel
          meetelt in het omzetcijfer op het overzicht. Zet het uit bij bijvoorbeeld een
          doorlopende post. Op de factuur en de PDF is er niets van te zien — het
          factuurtotaal blijft gewoon de som van alle regels.
        </p>
      </section>

      <button type="submit" className="btn-primair" disabled={bezig}>
        {bezig ? 'Bezig met genereren…' : `Factuur genereren (${factuurnummer})`}
      </button>
    </form>
  );
}
