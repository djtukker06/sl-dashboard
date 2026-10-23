'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { crmApi } from './CrmDialoog';

/**
 * Status die direct opslaat (de klant: lead/actief/afgerond). Standaard als knoppenrij
 * (alle keuzes zichtbaar, één klik); `lijst` geeft een keuzelijst.
 */
export function StatusKiezer({
  url,
  waarde,
  opties,
  label = 'Status',
  lijst = false,
  meldingen
}: {
  url: string;
  waarde: string;
  opties: [string, string][];
  label?: string;
  lijst?: boolean;
  /** Optionele bevestiging na opslaan (toast), per nieuwe status. */
  meldingen?: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(waarde);
  const [bezig, setBezig] = useState(false);

  async function wijzig(nieuw: string) {
    if (nieuw === status) return;
    const oud = status;
    setStatus(nieuw);
    setBezig(true);
    try {
      await crmApi(url, 'PATCH', { status: nieuw });
      if (meldingen?.[nieuw]) toast(meldingen[nieuw]);
      router.refresh();
    } catch (e) {
      setStatus(oud);
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBezig(false);
    }
  }

  if (!lijst) {
    return (
      <div className="ag-segment kp-statusknoppen" role="group" aria-label={label}>
        {opties.map(([w, l]) => (
          <button
            key={w}
            type="button"
            aria-pressed={status === w}
            className={status === w ? `is-aan kp-statusknop-${w}` : ''}
            disabled={bezig}
            onClick={() => void wijzig(w)}
          >
            {l}
          </button>
        ))}
      </div>
    );
  }

  return (
    <select
      className={`ag-veld kp-status kp-status-${status}`}
      aria-label={label}
      value={status}
      disabled={bezig}
      onChange={(e) => void wijzig(e.target.value)}
    >
      {opties.map(([w, l]) => (
        <option key={w} value={w}>
          {l}
        </option>
      ))}
    </select>
  );
}
