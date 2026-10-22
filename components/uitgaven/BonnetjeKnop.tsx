'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadBonnetje, type UploadFase } from '@/lib/uitgaven/client';

/**
 * "Bonnetje uploaden" (dashboard, /boekhouding): opent direct de bestandskiezer (op een
 * telefoon ook de camera), uploadt en leest uit, en opent daarna het bonnetje in
 * Bonnetjes & inkoopfacturen. Meerdere bestanden: daarna naar de lijst.
 */
export function BonnetjeKnop({ className = 'db-knop', label = '+ Bonnetje' }: { className?: string; label?: string }) {
  const router = useRouter();
  const kiezer = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<UploadFase | null>(null);
  const [fout, setFout] = useState('');

  async function gekozen(e: React.ChangeEvent<HTMLInputElement>) {
    const lijst = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!lijst.length) return;
    setFout('');
    const ids: string[] = [];
    try {
      for (const f of lijst) {
        const u = await uploadBonnetje(f, { onFase: setFase });
        ids.push(u.id);
      }
      router.push(ids.length === 1 ? `/boekhouding/bonnetjes?uitgave=${ids[0]}` : '/boekhouding/bonnetjes');
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Uploaden mislukt.');
      setFase(null);
      if (ids.length) router.push('/boekhouding/bonnetjes');
    }
  }

  const tekst =
    fase === 'uploaden' || fase === 'voorbereiden' ? 'Uploaden…' : fase === 'uitlezen' ? 'Uitlezen…' : fase === 'klaar' ? 'Openen…' : label;
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={fase !== null}
        title={fout || 'Bonnetje of inkoopfactuur uploaden (foto of PDF)'}
        aria-describedby={fout ? 'bonnetje-fout' : undefined}
        onClick={() => kiezer.current?.click()}
      >
        {tekst}
      </button>
      {fout && (
        <span id="bonnetje-fout" className="ug-knop-fout" role="alert">
          {fout}
        </span>
      )}
      <input ref={kiezer} type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden onChange={gekozen} />
    </>
  );
}
