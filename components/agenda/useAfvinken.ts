'use client';

import { useCallback, useRef } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Taak } from '@/lib/agenda/types';
import { useToast } from './Toast';

/**
 * Afvinken met directe (optimistische) weergave en 5 s "Ongedaan maken".
 * `pasAan` werkt de taak bij in de lokale lijsten; bij een fout wordt hij teruggezet.
 * Opslaan gebeurt per taak na elkaar, zodat "ongedaan maken" nooit eerder aankomt
 * dan het afvinken zelf.
 */
export function useAfvinken(pasAan: (t: Taak) => void): (t: Taak) => void {
  const toast = useToast();
  const wachtrij = useRef(new Map<string, Promise<unknown>>());

  const zet = useCallback(
    (t: Taak, af: boolean) => {
      pasAan({ ...t, afgerond: af, afgerondOp: af ? new Date().toISOString() : null });
      const vorige = wachtrij.current.get(t.id) ?? Promise.resolve();
      const volgende = vorige.then(async () => {
        try {
          const { task } = await agendaApi.wijzigTaak(t.id, { afgerond: af });
          pasAan(task);
        } catch (e) {
          pasAan({ ...t, afgerond: !af, afgerondOp: af ? null : t.afgerondOp });
          toast(e instanceof Error ? `Niet gelukt: ${e.message}` : 'Niet gelukt.', { fout: true });
        }
      });
      wachtrij.current.set(t.id, volgende);
      void volgende.finally(() => {
        if (wachtrij.current.get(t.id) === volgende) wachtrij.current.delete(t.id);
      });
    },
    [pasAan, toast]
  );

  return useCallback(
    (t: Taak) => {
      const af = !t.afgerond;
      zet(t, af);
      if (af) {
        const kort = t.titel.length > 40 ? t.titel.slice(0, 40) + '…' : t.titel;
        toast(`‘${kort}’ afgerond`, {
          actie: { label: 'Ongedaan maken', onClick: () => zet({ ...t, afgerond: true }, false) }
        });
      }
    },
    [zet, toast]
  );
}
