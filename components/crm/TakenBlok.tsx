'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Taak } from '@/lib/agenda/types';
import { TaakRij } from '@/components/agenda/TaakRij';
import { useToast } from '@/components/agenda/Toast';
import { useTaakDialoog } from '@/components/taken/TakenProvider';
import type { TaakStandaard } from '@/components/taken/TaakDialoog';

/**
 * Taken op de klant- of projectpagina: afvinken, openen (taak-popup) en "+ Taak" met de
 * klant of het project al ingevuld ("voor wie" staat standaard op jou). Afgeronde taken
 * staan ingeklapt onderaan. Na een wijziging haalt de pagina de gegevens opnieuw op.
 */
export function TakenBlok({
  taken,
  vandaag,
  standaard,
  leeg = 'Geen open taken.'
}: {
  taken: Taak[];
  vandaag: string;
  standaard: TaakStandaard;
  leeg?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { nieuw, open } = useTaakDialoog();
  // Direct zichtbaar afvinken; de echte stand komt met router.refresh().
  const [omgezet, setOmgezet] = useState<Record<string, boolean>>({});

  const lijst = taken.map((t) => (t.id in omgezet ? { ...t, afgerond: omgezet[t.id] } : t));
  const openTaken = lijst.filter((t) => !t.afgerond);
  const klaar = lijst.filter((t) => t.afgerond);

  async function wissel(t: Taak) {
    const nieuwAf = !t.afgerond;
    setOmgezet((m) => ({ ...m, [t.id]: nieuwAf }));
    try {
      await agendaApi.wijzigTaak(t.id, { afgerond: nieuwAf });
      router.refresh();
    } catch (e) {
      setOmgezet((m) => ({ ...m, [t.id]: !nieuwAf }));
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    }
  }

  return (
    <div className="kp-taken">
      {openTaken.length === 0 ? (
        <p className="kp-leeg">{leeg}</p>
      ) : (
        <ul className="ag-taken kp-takenlijst">
          {openTaken.map((t) => (
            <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={wissel} onOpen={(x) => open(x.id)} />
          ))}
        </ul>
      )}
      <div className="kp-taken-voet">
        <button type="button" className="db-knop" onClick={() => nieuw(standaard)}>
          + Taak
        </button>
      </div>
      {klaar.length > 0 && (
        <details className="kp-klaar">
          <summary>
            {klaar.length} afgerond{klaar.length === 1 ? 'e taak' : 'e taken'}
          </summary>
          <ul className="ag-taken kp-takenlijst">
            {klaar.map((t) => (
              <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={wissel} onOpen={(x) => open(x.id)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
