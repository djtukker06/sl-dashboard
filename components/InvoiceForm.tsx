'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClientCombobox } from './ClientCombobox';
import { bedrijf } from '@/lib/config';
import {
  BTW_VERLEGD_TEKST,
  LEGE_REGEL,
  type BtwVerlegdAls,
  type FactuurBeginwaarden,
  type RegelInvoer
} from '@/lib/invoice/formulier';

// Zonder factuurId maakt dit formulier een nieuwe factuur aan; mét factuurId bewerkt het
// een bestaande. Verder is het scherm precies hetzelfde — alleen al ingevuld.
export function InvoiceForm({
  beginwaarden,
  factuurId
}: {
  beginwaarden: FactuurBeginwaarden;
  factuurId?: string;
}) {
  const router = useRouter();
  const bewerken = Boolean(factuurId);

  const [factuurnummer, setFactuurnummer] = useState(beginwaarden.factuurnummer);
  const [datum, setDatum] = useState(beginwaarden.datum);
  const [naamFactuur, setNaamFactuur] = useState(beginwaarden.naamFactuur);
  // Zolang de naam niet zelf is aangepast, loopt hij mee met het factuurnummer. Bij een
  // bestaande factuur met een eigen omschrijving blijft die dus staan.
  const [naamZelfAangepast, setNaamZelfAangepast] = useState(
    beginwaarden.naamFactuur !== `Factuur ${beginwaarden.factuurnummer}`
  );

  function wijzigFactuurnummer(waarde: string) {
    setFactuurnummer(waarde);
    if (!naamZelfAangepast) setNaamFactuur(`Factuur ${waarde}`);
  }
  const [klantBedrijfsnaam, setKlantBedrijfsnaam] = useState(beginwaarden.klantBedrijfsnaam);
  const [klantTav, setKlantTav] = useState(beginwaarden.klantTav);
  const [klantAdres, setKlantAdres] = useState(beginwaarden.klantAdres);
  const [klantPostcode, setKlantPostcode] = useState(beginwaarden.klantPostcode);
  const [middenKolomLabel, setMiddenKolomLabel] = useState(beginwaarden.middenKolomLabel);
  const [btwVerlegd, setBtwVerlegd] = useState(beginwaarden.btwVerlegd);
  const [btwVerlegdAls, setBtwVerlegdAls] = useState<BtwVerlegdAls>(beginwaarden.btwVerlegdAls);
  const [btwVerlegdReden, setBtwVerlegdReden] = useState(beginwaarden.btwVerlegdReden);
  const [regels, setRegels] = useState<RegelInvoer[]>(beginwaarden.regels);
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

    const res = await fetch(bewerken ? `/api/invoices/${factuurId}` : '/api/invoices', {
      method: bewerken ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        factuurnummer,
        naamFactuur,
        datum,
        klantBedrijfsnaam,
        klantTav,
        klantAdres,
        klantPostcode,
        middenKolomLabel,
        btwVerlegd,
        btwVerlegdAls,
        btwVerlegdReden,
        regels
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFout(
        data.error ||
          (bewerken
            ? 'Er ging iets mis bij het opslaan van de wijzigingen.'
            : 'Er ging iets mis bij het aanmaken van de factuur.')
      );
      setBezig(false);
      return;
    }

    const data = await res.json();

    if (bewerken) {
      // Terug naar het overzicht, met een verse serverrender: het bijgewerkte bedrag en
      // de jaaromzet moeten er meteen goed staan.
      router.push('/');
      router.refresh();
      return;
    }
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
              onChange={(e) => wijzigFactuurnummer(e.target.value)}
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

        <label className="naam-factuur-input">
          Naam factuur
          <input
            type="text"
            required
            value={naamFactuur}
            onChange={(e) => {
              setNaamZelfAangepast(true);
              setNaamFactuur(e.target.value);
            }}
          />
        </label>

        <p className="veld-hint">
          Nummer en datum zijn automatisch ingevuld — pas ze aan als het anders moet,
          bijvoorbeeld bij het invoeren van een oudere factuur. Het jaartal in het nummer
          moet gelijk zijn aan het jaar van de datum. De naam wordt de bestandsnaam van de
          PDF; typ er gerust een omschrijving achter. Op de factuur zelf komt de naam niet
          te staan.
        </p>
      </section>

      <section className="card">
        <h2>Btw</h2>
        <label className="checkbox-regel">
          <input
            type="checkbox"
            checked={btwVerlegd}
            onChange={(e) => setBtwVerlegd(e.target.checked)}
          />
          <span>Btw verlegd — geen btw op deze factuur</span>
        </label>

        {btwVerlegd && (
          <fieldset className="btw-weergave-keuze">
            <legend>Op de factuur bij Btw</legend>
            {(Object.keys(BTW_VERLEGD_TEKST) as BtwVerlegdAls[]).map((optie) => (
              <label key={optie} className="checkbox-regel">
                <input
                  type="radio"
                  name="btwVerlegdAls"
                  value={optie}
                  checked={btwVerlegdAls === optie}
                  onChange={() => setBtwVerlegdAls(optie)}
                />
                <span>{BTW_VERLEGD_TEKST[optie]}</span>
              </label>
            ))}
          </fieldset>
        )}

        {btwVerlegd && (
          <label className="reden-input">
            Reden btw verlegd
            <input
              type="text"
              value={btwVerlegdReden}
              placeholder="Bijv. Btw verlegd conform artikel 12 lid 5 Wet OB 1968."
              onChange={(e) => setBtwVerlegdReden(e.target.value)}
            />
          </label>
        )}

        <p className="veld-hint">
          {btwVerlegd ? (
            <>
              Op de factuur staat bij Btw{' '}
              <strong>{BTW_VERLEGD_TEKST[btwVerlegdAls]}</strong> in plaats van een bedrag,
              en het totaal is gelijk aan het subtotaal. De reden komt als extra regel
              onderaan de PDF te staan, boven de vaste teksten. Laat je hem leeg, dan komt
              er geen extra regel bij.
            </>
          ) : (
            <>
              Er wordt {bedrijf.btwPercentage}% btw gerekend, zoals gebruikelijk. Vink dit
              aan als de btw verlegd wordt naar de klant — dan komt er geen btw-bedrag op
              de factuur.
            </>
          )}
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
        {bewerken
          ? bezig
            ? 'Bezig met opslaan…'
            : 'Wijzigingen opslaan'
          : bezig
            ? 'Bezig met genereren…'
            : `Factuur genereren (${factuurnummer})`}
      </button>
    </form>
  );
}
