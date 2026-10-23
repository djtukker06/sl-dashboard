'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveItem } from '@/lib/drive/types';
import { uploadBestand, type UploadDoel } from './driveApi';

export type UploadRij = { sleutel: number; naam: string; voortgang: number; fase: 'wacht' | 'bezig' | 'klaar' | 'fout'; fout?: string };

const TEGELIJK = 3;

/** Wachtrij voor uploads naar Drive: drie tegelijk, met voortgang per bestand. */
export function useDriveUpload(onKlaar: (item: DriveItem, doel: UploadDoel) => void) {
  const [rijen, setRijen] = useState<UploadRij[]>([]);
  const teller = useRef(0);
  const terug = useRef(onKlaar);
  useEffect(() => {
    terug.current = onKlaar;
  });

  const zet = (sleutel: number, w: Partial<UploadRij>) => setRijen((l) => l.map((r) => (r.sleutel === sleutel ? { ...r, ...w } : r)));

  const upload = useCallback(async (bestanden: File[] | FileList, doel: UploadDoel) => {
    const lijst = Array.from(bestanden).filter((f) => f.size > 0 || f.type);
    if (!lijst.length) return;
    const nieuw: UploadRij[] = lijst.map((f) => ({ sleutel: ++teller.current, naam: f.name || 'Naamloos', voortgang: 0, fase: 'wacht' }));
    setRijen((l) => [...l.filter((r) => r.fase !== 'klaar'), ...nieuw]);
    let volgende = 0;
    async function werker() {
      while (volgende < lijst.length) {
        const i = volgende++;
        const rij = nieuw[i];
        zet(rij.sleutel, { fase: 'bezig' });
        try {
          const item = await uploadBestand(lijst[i], doel, (v) => zet(rij.sleutel, { voortgang: v }));
          zet(rij.sleutel, { fase: 'klaar', voortgang: 1 });
          terug.current(item, doel);
        } catch (e) {
          zet(rij.sleutel, { fase: 'fout', fout: e instanceof Error ? e.message : 'Mislukt.' });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(TEGELIJK, lijst.length) }, werker));
    // Geslaagde regels na een moment opruimen; fouten blijven staan tot de volgende upload.
    setTimeout(() => setRijen((l) => l.filter((r) => r.fase !== 'klaar')), 2500);
  }, []);

  const wis = useCallback(() => setRijen([]), []);
  return { rijen, upload, wis };
}
