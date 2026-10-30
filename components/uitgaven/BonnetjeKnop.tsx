'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadBonnetje, type UploadFase } from '@/lib/uitgaven/client';
import { UgIcoon } from './Iconen';

/**
 * "Bonnetje uploaden" (dashboard, /boekhouding): opent direct de bestandskiezer, uploadt en
 * leest uit, en opent daarna het bonnetje in Bonnetjes & inkoopfacturen. Meerdere
 * bestanden: daarna naar de lijst. Op een aanraakscherm staat ernaast een cameraknop die
 * meteen de achtercamera opent (`camera={false}` laat hem weg).
 */
export function BonnetjeKnop({
  className = 'db-knop',
  label = '+ Bonnetje',
  camera = true
}: {
  className?: string;
  label?: string;
  camera?: boolean;
}) {
  const router = useRouter();
  const kiezer = useRef<HTMLInputElement>(null);
  const cameraKiezer = useRef<HTMLInputElement>(null);
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
    fase === 'omzetten' ? 'Foto omzetten…' : fase === 'uploaden' || fase === 'voorbereiden' ? 'Uploaden…' : fase === 'uitlezen' ? 'Uitlezen…' : fase === 'klaar' ? 'Openen…' : label;
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
      {camera && (
        <button
          type="button"
          className="db-knop ug-alleen-mobiel ug-camera-knop"
          disabled={fase !== null}
          title="Foto maken van een bonnetje"
          aria-label="Foto maken van een bonnetje"
          onClick={() => cameraKiezer.current?.click()}
        >
          <UgIcoon naam="camera" grootte={18} />
          <span className="ug-camera-label">Foto</span>
        </button>
      )}
      {fout && (
        <span id="bonnetje-fout" className="ug-knop-fout" role="alert">
          {fout}
        </span>
      )}
      <input ref={kiezer} type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden onChange={gekozen} />
      {camera && <input ref={cameraKiezer} type="file" accept="image/*" capture="environment" hidden onChange={gekozen} />}
    </>
  );
}
