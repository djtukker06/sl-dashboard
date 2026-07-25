'use client';

import { useState, useTransition } from 'react';
import { deleteClient, updateClient } from '@/app/actions/clients';

export interface KlantRecord {
  id: string;
  company_name: string;
  contact_name: string | null;
  address: string | null;
  postal_code: string | null;
}

export function ClientEditForm({
  klant,
  aantalFacturen
}: {
  klant: KlantRecord;
  aantalFacturen: number;
}) {
  const [bedrijfsnaam, setBedrijfsnaam] = useState(klant.company_name);
  const [tav, setTav] = useState(klant.contact_name || '');
  const [adres, setAdres] = useState(klant.address || '');
  const [postcode, setPostcode] = useState(klant.postal_code || '');
  const [fout, setFout] = useState<string | null>(null);
  const [opgeslagen, setOpgeslagen] = useState(false);
  const [bezig, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    setOpgeslagen(false);

    startTransition(async () => {
      const resultaat = await updateClient(klant.id, {
        company_name: bedrijfsnaam,
        contact_name: tav,
        address: adres,
        postal_code: postcode
      });

      if (resultaat.error) {
        setFout(resultaat.error);
        return;
      }
      setOpgeslagen(true);
    });
  }

  function handleDelete() {
    setFout(null);
    setOpgeslagen(false);

    if (aantalFacturen > 0) {
      setFout(
        `Deze klant heeft nog ${aantalFacturen} factu${aantalFacturen === 1 ? 'ur' : 'ren'} in het archief. Verwijder die eerst via het overzicht als je de klant echt wilt weghalen.`
      );
      return;
    }
    if (!confirm(`Klant "${klant.company_name}" definitief verwijderen?`)) return;

    startTransition(async () => {
      const resultaat = await deleteClient(klant.id);
      if (resultaat?.error) setFout(resultaat.error);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {fout && <div className="foutmelding">{fout}</div>}
      {opgeslagen && <div className="geluktmelding">Klantgegevens opgeslagen.</div>}

      <section className="card">
        <h2>Klantgegevens</h2>
        <div className="grid-2">
          <label>
            Bedrijfsnaam
            <input
              type="text"
              required
              value={bedrijfsnaam}
              onChange={(e) => setBedrijfsnaam(e.target.value)}
            />
          </label>
          <label>
            T.a.v. (naam eigenaar/contactpersoon)
            <input type="text" value={tav} onChange={(e) => setTav(e.target.value)} />
          </label>
          <label>
            Adres (straat + huisnummer, plaats)
            <input type="text" value={adres} onChange={(e) => setAdres(e.target.value)} />
          </label>
          <label>
            Postcode
            <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
          </label>
        </div>

        <p className="veld-hint">
          Deze gegevens worden gebruikt bij een volgende factuur. Al gemaakte facturen
          houden hun eigen gegevens van het moment van factureren — die veranderen dus niet.
        </p>

        <div className="klant-acties">
          <button type="submit" className="btn-primair klein" disabled={bezig}>
            {bezig ? 'Bezig…' : 'Wijzigingen opslaan'}
          </button>
          <button type="button" className="btn-gevaar" disabled={bezig} onClick={handleDelete}>
            Klant verwijderen
          </button>
        </div>
      </section>
    </form>
  );
}
