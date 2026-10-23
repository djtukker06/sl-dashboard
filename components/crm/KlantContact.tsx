'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import type { Klant } from '@/lib/crm/types';
import { crmApi } from './CrmDialoog';

type Velden = Pick<Klant, 'naam' | 'contactpersoon' | 'email' | 'telefoon' | 'adres' | 'postcode'>;

/** Contactgegevens: lezen, en met één knop "Bewerken" alles tegelijk aanpassen. */
export function KlantContact({ klant }: { klant: Klant }) {
  const router = useRouter();
  const toast = useToast();
  const [bewerk, setBewerk] = useState(false);
  const [v, setV] = useState<Velden>(klant);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  function zet<K extends keyof Velden>(k: K, w: string) {
    setV((x) => ({ ...x, [k]: w }));
  }

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout('');
    try {
      await crmApi(`/api/klanten/${klant.id}`, 'PATCH', {
        naam: v.naam,
        contactpersoon: v.contactpersoon,
        email: v.email,
        telefoon: v.telefoon,
        adres: v.adres,
        postcode: v.postcode
      });
      setBewerk(false);
      toast('Contactgegevens opgeslagen');
      router.refresh();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
    } finally {
      setBezig(false);
    }
  }

  if (!bewerk) {
    const leeg = !klant.contactpersoon && !klant.email && !klant.telefoon && !klant.adres && !klant.postcode;
    return (
      <div className="kp-contact">
        {leeg ? (
          <p className="kp-leeg">Nog geen contactgegevens.</p>
        ) : (
          <dl className="kp-dl">
            {klant.contactpersoon && (
              <div>
                <dt>Contactpersoon</dt>
                <dd>{klant.contactpersoon}</dd>
              </div>
            )}
            {klant.email && (
              <div>
                <dt>E-mail</dt>
                <dd>
                  <a href={`/mail?nieuw=1&aan=${encodeURIComponent(klant.email)}`} title="Mail schrijven">
                    {klant.email}
                  </a>
                </dd>
              </div>
            )}
            {klant.telefoon && (
              <div>
                <dt>Telefoon</dt>
                <dd>
                  <a href={`tel:${klant.telefoon.replace(/[^0-9+]/g, '')}`}>{klant.telefoon}</a>
                </dd>
              </div>
            )}
            {(klant.adres || klant.postcode) && (
              <div>
                <dt>Adres</dt>
                <dd>{[klant.adres, klant.postcode].filter(Boolean).join(', ')}</dd>
              </div>
            )}
          </dl>
        )}
        <button
          type="button"
          className="db-knop"
          onClick={() => {
            setV(klant);
            setBewerk(true);
          }}
        >
          Bewerken
        </button>
      </div>
    );
  }

  return (
    <form
      className="kp-form"
      onSubmit={opslaan}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape') setBewerk(false);
      }}
    >
      <label className="ag-label">
        Bedrijfsnaam
        <input className="ag-veld" value={v.naam} maxLength={200} onChange={(e) => zet('naam', e.target.value)} autoFocus />
      </label>
      <label className="ag-label">
        Contactpersoon
        <input className="ag-veld" value={v.contactpersoon} maxLength={200} onChange={(e) => zet('contactpersoon', e.target.value)} />
      </label>
      <label className="ag-label">
        E-mail
        <input className="ag-veld" type="email" value={v.email} maxLength={320} onChange={(e) => zet('email', e.target.value)} />
      </label>
      <label className="ag-label">
        Telefoon
        <input className="ag-veld" type="tel" value={v.telefoon} maxLength={40} onChange={(e) => zet('telefoon', e.target.value)} />
      </label>
      <label className="ag-label">
        Adres
        <input className="ag-veld" value={v.adres} maxLength={300} onChange={(e) => zet('adres', e.target.value)} />
      </label>
      <label className="ag-label">
        Postcode en plaats
        <input className="ag-veld" value={v.postcode} maxLength={20} onChange={(e) => zet('postcode', e.target.value)} />
      </label>
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
      <div className="kp-form-acties">
        <button type="button" className="db-knop" onClick={() => setBewerk(false)}>
          Annuleren
        </button>
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
          {bezig ? 'Bezig…' : 'Opslaan'}
        </button>
      </div>
    </form>
  );
}
