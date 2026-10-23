'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { KlantStatus } from '@/lib/crm/types';
import { CrmDialoog, crmApi } from './CrmDialoog';

/**
 * "+ Klant": een kleine popup met bedrijfsnaam (verplicht), contactpersoon, e-mail en
 * status (standaard Lead). Na opslaan ga je naar de klantpagina.
 */
export function SnelKlant({ startOpen = false }: { startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [naam, setNaam] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<KlantStatus>('lead');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  function sluit() {
    setOpen(false);
    setFout('');
    if (startOpen) router.replace('/klanten');
  }

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) {
      setFout('Vul de bedrijfsnaam in.');
      return;
    }
    setBezig(true);
    setFout('');
    try {
      const { klant } = await crmApi<{ klant: { id: string } }>('/api/klanten', 'POST', {
        naam,
        contactpersoon: contact,
        email,
        status
      });
      router.push(`/klanten/${klant.id}`);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
      setBezig(false);
    }
  }

  return (
    <>
      <button type="button" className="db-knop db-knop-primair" onClick={() => setOpen(true)}>
        + Klant
      </button>
      {open && (
        <CrmDialoog titel="Nieuwe klant" onSluit={sluit}>
          <form className="kp-form" onSubmit={opslaan} noValidate>
            <label className="ag-label">
              Bedrijfsnaam
              <input className="ag-veld" value={naam} maxLength={200} required onChange={(e) => setNaam(e.target.value)} />
            </label>
            <label className="ag-label">
              Contactpersoon
              <input className="ag-veld" value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} />
            </label>
            <label className="ag-label">
              E-mail
              <input className="ag-veld" type="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="ag-label">
              <span>Status</span>
              <div className="ag-segment" role="group" aria-label="Status">
                {(['lead', 'actief'] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} className={status === s ? 'is-aan' : ''} onClick={() => setStatus(s)}>
                    {s === 'lead' ? 'Lead' : 'Actief'}
                  </button>
                ))}
              </div>
            </div>
            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
            <div className="kp-form-acties">
              <button type="button" className="db-knop" onClick={sluit}>
                Annuleren
              </button>
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                {bezig ? 'Bezig…' : 'Klant toevoegen'}
              </button>
            </div>
          </form>
        </CrmDialoog>
      )}
    </>
  );
}
