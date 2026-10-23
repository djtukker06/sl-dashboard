'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { crmApi } from './CrmDialoog';

/** Status als keuzelijst die direct opslaat (klant: lead/actief/afgerond; project: gepland/bezig/afgerond). */
export function StatusKiezer({
  url,
  waarde,
  opties,
  label = 'Status'
}: {
  url: string;
  waarde: string;
  opties: [string, string][];
  label?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(waarde);
  const [bezig, setBezig] = useState(false);

  async function wijzig(nieuw: string) {
    const oud = status;
    setStatus(nieuw);
    setBezig(true);
    try {
      await crmApi(url, 'PATCH', { status: nieuw });
      router.refresh();
    } catch (e) {
      setStatus(oud);
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBezig(false);
    }
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
