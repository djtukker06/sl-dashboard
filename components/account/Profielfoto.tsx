'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FOTO_MAX_BYTES, FOTO_MAX_PX } from '@/lib/team/foto';

type Melding = { soort: 'ok' | 'fout'; tekst: string } | null;

const SOORTEN = ['image/jpeg', 'image/png', 'image/webp'];

/** Laadt een gekozen bestand als beeld (EXIF-draaiing wordt door de browser toegepast). */
async function laadBeeld(bestand: File): Promise<{ beeld: CanvasImageSource; b: number; h: number; sluit: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(bestand);
      return { beeld: bm, b: bm.width, h: bm.height, sluit: () => bm.close() };
    } catch {
      // val terug op <img>
    }
  }
  const url = URL.createObjectURL(bestand);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Deze foto kan de browser niet openen. Kies een JPG, PNG of WebP.');
  }
  return { beeld: img, b: img.naturalWidth, h: img.naturalHeight, sluit: () => URL.revokeObjectURL(url) };
}

function naarBlob(canvas: HTMLCanvasElement, type: string, kwaliteit: number): Promise<Blob | null> {
  return new Promise((klaar) => canvas.toBlob(klaar, type, kwaliteit));
}

/** Snijdt bij tot een vierkant uit het midden en verkleint tot max. 512×512, als WebP (of JPG). */
async function maakVierkant(bestand: File): Promise<Blob> {
  const { beeld, b, h, sluit } = await laadBeeld(bestand);
  try {
    if (!b || !h) throw new Error('Deze foto is leeg.');
    const zijde = Math.min(b, h);
    const maat = Math.min(FOTO_MAX_PX, zijde);
    const canvas = document.createElement('canvas');
    canvas.width = maat;
    canvas.height = maat;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Je browser kan de foto niet verkleinen.');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(beeld, (b - zijde) / 2, (h - zijde) / 2, zijde, zijde, 0, 0, maat, maat);
    // Safari maakt (nog) geen WebP: dan geeft toBlob een PNG terug. Dan liever JPG (kleiner).
    const webp = await naarBlob(canvas, 'image/webp', 0.86);
    if (webp && webp.type === 'image/webp') return webp;
    const jpg = await naarBlob(canvas, 'image/jpeg', 0.88);
    if (jpg) return jpg;
    throw new Error('Je browser kan de foto niet verkleinen.');
  } finally {
    sluit();
  }
}

// Profielfoto bij Account: kiezen (wordt in de browser vierkant en klein gemaakt) en
// verwijderen. De foto staat daarna overal waar je initialen stonden (het voorbeeld erboven
// in ProfielBlok toont hem al, via onWijzig).
export function Profielfoto({
  foto: start,
  uitgeschakeld,
  onWijzig
}: {
  foto: string | null;
  uitgeschakeld: boolean;
  onWijzig: (foto: string | null) => void;
}) {
  const router = useRouter();
  const invoer = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState(start);
  const [bezig, setBezig] = useState<'' | 'upload' | 'weg'>('');
  const [melding, setMelding] = useState<Melding>(null);

  function zet(nieuw: string | null, tekst: string) {
    setFoto(nieuw);
    onWijzig(nieuw);
    setMelding({ soort: 'ok', tekst });
    router.refresh(); // rail en avatars bijwerken
  }

  async function verstuur(method: 'POST' | 'DELETE', body?: FormData): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch('/api/account/foto', { method, body, cache: 'no-store' });
    } catch {
      throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.');
    }
    if (res.status === 401) {
      router.replace('/login?next=/account');
      throw new Error('Je bent uitgelogd.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || 'Er ging iets mis.');
    return (data && typeof data.foto === 'string' ? data.foto : null) as string | null;
  }

  async function kies(e: React.ChangeEvent<HTMLInputElement>) {
    const bestand = e.target.files?.[0];
    e.target.value = ''; // dezelfde foto nog eens kiezen mag
    if (!bestand) return;
    if (!SOORTEN.includes(bestand.type)) {
      setMelding({ soort: 'fout', tekst: 'Kies een JPG-, PNG- of WebP-afbeelding.' });
      return;
    }
    setBezig('upload');
    setMelding(null);
    try {
      const blob = await maakVierkant(bestand);
      if (blob.size > FOTO_MAX_BYTES) throw new Error('De foto is te groot (maximaal 2 MB).');
      const form = new FormData();
      form.append('foto', blob, blob.type === 'image/webp' ? 'foto.webp' : 'foto.jpg');
      zet(await verstuur('POST', form), 'Profielfoto opgeslagen.');
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Uploaden mislukt.' });
    } finally {
      setBezig('');
    }
  }

  async function verwijder() {
    setBezig('weg');
    setMelding(null);
    try {
      await verstuur('DELETE');
      zet(null, 'Profielfoto verwijderd.');
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Verwijderen mislukt.' });
    } finally {
      setBezig('');
    }
  }

  return (
    <div className="ac-foto">
      <div className="ac-foto-tekst">
        <span className="ac-legend">Profielfoto</span>
        <div className="ac-foto-knoppen">
          <button
            type="button"
            className="db-knop"
            disabled={uitgeschakeld || bezig !== ''}
            onClick={() => invoer.current?.click()}
          >
            {bezig === 'upload' ? 'Uploaden…' : foto ? 'Andere foto' : 'Foto kiezen'}
          </button>
          {foto && (
            <button type="button" className="ag-link-knop" disabled={uitgeschakeld || bezig !== ''} onClick={verwijder}>
              {bezig === 'weg' ? 'Verwijderen…' : 'Verwijderen'}
            </button>
          )}
          <input
            ref={invoer}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={kies}
          />
        </div>
        {melding ? (
          <p className={melding.soort === 'fout' ? 'ag-fout' : 'ac-ok'} role={melding.soort === 'fout' ? 'alert' : 'status'}>
            {melding.tekst}
          </p>
        ) : (
          <p className="ag-uitleg">Wordt vierkant bijgesneden. Zonder foto zie je je initialen.</p>
        )}
      </div>
    </div>
  );
}
