'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { ProjectStatus } from '@/lib/agenda/types';
import { korteDatum } from '@/lib/dashboard/tijd';
import { BORD_STATUSSEN, PROJECT_STATUS_LABEL, dagenSinds, dagenTekst } from '@/lib/crm/projectstatus';
import { useToast } from '@/components/agenda/Toast';

/**
 * Stappenbalk op de projectpagina: Voorbereiding → Bezig → Wachten op goedkeuring →
 * Afgerond. Eén klik zet de status (direct opgeslagen); daaronder sinds wanneer.
 */
export function StatusStappen({
  projectId,
  status: start,
  statusSinds,
  nu
}: {
  projectId: string;
  status: ProjectStatus;
  statusSinds: string | null;
  nu: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(start);
  const [bezig, setBezig] = useState(false);
  const huidig = BORD_STATUSSEN.indexOf(status);
  const dagen = status === start ? dagenSinds(statusSinds, new Date(nu)) : 0;

  async function kies(s: ProjectStatus) {
    if (s === status || bezig) return;
    const oud = status;
    setStatus(s);
    setBezig(true);
    try {
      await agendaApi.wijzigProject(projectId, { status: s });
      toast(`Status: ${PROJECT_STATUS_LABEL[s]}`);
      router.refresh();
    } catch (e) {
      setStatus(oud);
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="kp-stappen-blok">
      <ol className="kp-stappen" aria-label="Status van het project">
        {BORD_STATUSSEN.map((s, i) => (
          <li key={s} className={i < huidig ? 'is-voorbij' : i === huidig ? 'is-nu' : ''}>
            <button type="button" aria-pressed={i === huidig} aria-current={i === huidig ? 'step' : undefined} disabled={bezig && i !== huidig} onClick={() => void kies(s)}>
              <span className="kp-stap-nr" aria-hidden="true">
                {i < huidig ? '✓' : i + 1}
              </span>
              <span className="kp-stap-label">{PROJECT_STATUS_LABEL[s]}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="kp-stappen-sinds" role="status" aria-live="polite">
        {dagen !== null && statusSinds && status === start
          ? `${PROJECT_STATUS_LABEL[status]} sinds ${korteDatum(statusSinds)} (${dagen === 0 ? 'vandaag' : dagenTekst(dagen)})`
          : status !== start
            ? `${PROJECT_STATUS_LABEL[status]} sinds vandaag`
            : ' '}
      </p>
    </div>
  );
}
