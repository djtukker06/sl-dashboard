'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { typeVan, uploadBonnetje, type UploadFase } from '@/lib/uitgaven/client';
import type { Uitgave } from '@/lib/uitgaven/model';

export type UploadItem = { sleutel: number; naam: string; fase: UploadFase; fout?: string; uitgaveId?: string };

const TEGELIJK = 2;

/**
 * Wachtrij voor bonnetjes: elk bestand wordt een eigen upload en wordt uitgelezen.
 * Twee tegelijk, zodat tien foto's niet tien keer tegelijk Claude aanroepen.
 * `onUitgave` krijgt elke nieuwe uitgave direct na het uploaden én nog eens na het uitlezen;
 * `onAlles` de hele batch na afloop.
 */
export function useUploads({
  onUitgave,
  onAlles
}: {
  onUitgave?: (u: Uitgave) => void;
  onAlles?: (nieuw: Uitgave[], fouten: number) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const teller = useRef(0);
  const bezig = useRef(false);
  const callbacks = useRef({ onUitgave, onAlles });
  useEffect(() => {
    callbacks.current = { onUitgave, onAlles };
  });

  const zet = (sleutel: number, w: Partial<UploadItem>) =>
    setItems((l) => l.map((it) => (it.sleutel === sleutel ? { ...it, ...w } : it)));

  const voegToe = useCallback(async (bestanden: File[] | FileList) => {
    const lijst = Array.from(bestanden);
    if (!lijst.length) return;
    const nieuw: UploadItem[] = lijst.map((f) => ({ sleutel: ++teller.current, naam: f.name || 'Geplakte afbeelding', fase: 'voorbereiden' }));
    setItems((l) => [...l.filter((it) => it.fase !== 'klaar'), ...nieuw]);
    bezig.current = true;

    const resultaten: Uitgave[] = [];
    let fouten = 0;
    let volgende = 0;
    async function werker() {
      while (volgende < lijst.length) {
        const i = volgende++;
        const f = lijst[i];
        const it = nieuw[i];
        if (!typeVan(f)) {
          fouten++;
          zet(it.sleutel, { fase: 'fout', fout: 'Alleen foto’s en PDF’s' });
          continue;
        }
        try {
          const u = await uploadBonnetje(f, {
            onFase: (fase) => zet(it.sleutel, { fase }),
            // Meteen tonen ("Wordt uitgelezen…"); na het uitlezen volgt de bijgewerkte versie.
            onAangemeld: (nieuw) => {
              zet(it.sleutel, { uitgaveId: nieuw.id });
              callbacks.current.onUitgave?.(nieuw);
            }
          });
          resultaten.push(u);
          zet(it.sleutel, { fase: 'klaar', uitgaveId: u.id });
          callbacks.current.onUitgave?.(u);
        } catch (e) {
          fouten++;
          zet(it.sleutel, { fase: 'fout', fout: e instanceof Error ? e.message : 'Mislukt' });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(TEGELIJK, lijst.length) }, werker));
    bezig.current = false;
    callbacks.current.onAlles?.(resultaten, fouten);
    // Geslaagde regels na een paar seconden weg; fouten blijven staan tot de volgende batch.
    window.setTimeout(() => {
      if (!bezig.current) setItems((l) => l.filter((x) => x.fase !== 'klaar'));
    }, 4000);
  }, []);

  const wis = useCallback((sleutel: number) => setItems((l) => l.filter((x) => x.sleutel !== sleutel)), []);

  return { items, voegToe, wis, bezig: items.some((x) => x.fase !== 'klaar' && x.fase !== 'fout') };
}

export const FASE_TEKST: Record<UploadFase, string> = {
  voorbereiden: 'Voorbereiden…',
  uploaden: 'Uploaden…',
  uitlezen: 'Uitlezen…',
  klaar: 'Klaar',
  fout: 'Mislukt'
};
