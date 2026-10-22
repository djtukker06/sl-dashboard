'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { typtIn } from '@/lib/agenda/client';
import { FASE_TEKST, type UploadItem } from './useUploads';
import { UgIcoon } from './Iconen';

const ACCEPT = 'image/*,application/pdf,.heic,.heif,.pdf';

/**
 * Brede dropzone bovenaan: slepen (overal op de pagina), kiezen, foto maken (mobiel) of
 * plakken (⌘V). Elk bestand wordt een eigen upload. `kiezer` is van de ouder, zodat de
 * sneltoets n de bestandskiezer kan openen.
 */
export function Toevoegen({
  items,
  onBestanden,
  onWis,
  nadruk,
  kiezer
}: {
  items: UploadItem[];
  onBestanden: (f: File[]) => void;
  onWis: (sleutel: number) => void;
  nadruk: boolean;
  kiezer: RefObject<HTMLInputElement | null>;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const [sleep, setSleep] = useState(false);
  const diepte = useRef(0);

  // Plakken van een screenshot (⌘V / Ctrl+V), behalve als je in een tekstveld plakt.
  useEffect(() => {
    function plak(e: ClipboardEvent) {
      const bestanden = Array.from(e.clipboardData?.files ?? []);
      if (!bestanden.length) return;
      if (typtIn(e.target) && !bestanden.some((f) => f.type.startsWith('image/') || f.type === 'application/pdf')) return;
      e.preventDefault();
      onBestanden(
        bestanden.map((f, i) =>
          f.name && f.name !== 'image.png'
            ? f
            : new File([f], `screenshot-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}${i ? `-${i + 1}` : ''}.png`, {
                type: f.type || 'image/png'
              })
        )
      );
    }
    document.addEventListener('paste', plak);
    return () => document.removeEventListener('paste', plak);
  }, [onBestanden]);

  // Slepen over de hele pagina laat de dropzone oplichten.
  useEffect(() => {
    const heeftBestanden = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    function binnen(e: DragEvent) {
      if (!heeftBestanden(e)) return;
      diepte.current++;
      setSleep(true);
    }
    function buiten(e: DragEvent) {
      if (!heeftBestanden(e)) return;
      diepte.current = Math.max(0, diepte.current - 1);
      if (!diepte.current) setSleep(false);
    }
    function over(e: DragEvent) {
      if (heeftBestanden(e)) e.preventDefault();
    }
    function los(e: DragEvent) {
      if (!heeftBestanden(e)) return;
      e.preventDefault();
      diepte.current = 0;
      setSleep(false);
      const f = Array.from(e.dataTransfer?.files ?? []);
      if (f.length) onBestanden(f);
    }
    window.addEventListener('dragenter', binnen);
    window.addEventListener('dragleave', buiten);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', los);
    return () => {
      window.removeEventListener('dragenter', binnen);
      window.removeEventListener('dragleave', buiten);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', los);
    };
  }, [onBestanden]);

  function gekozen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (f.length) onBestanden(f);
  }

  return (
    <section className={`ug-drop${sleep ? ' is-sleep' : ''}${nadruk ? ' is-nadruk' : ''}`} aria-label="Uploaden">
      <div className="ug-drop-inhoud">
        <UgIcoon naam="bon" grootte={28} className="ug-drop-icoon" />
        <div className="ug-drop-tekst">
          <p className="ug-drop-titel">{sleep ? 'Laat los om te uploaden' : 'Sleep bonnetjes of inkoopfacturen hierheen'}</p>
          <p className="ug-drop-sub">
            Foto’s of PDF’s, meerdere tegelijk, of plak een screenshot met <kbd>⌘</kbd> <kbd>V</kbd>. Leverancier, datum
            en bedrag worden vanzelf uitgelezen, zodat je alles later snel terugvindt.
          </p>
        </div>
        <div className="ug-drop-knoppen">
          <button
            type="button"
            className="db-knop db-knop-primair ug-knop-groot"
            title="Bestanden kiezen (n)"
            onClick={() => kiezer.current?.click()}
          >
            <UgIcoon naam="plus" grootte={16} /> Kies bestanden
          </button>
          <button type="button" className="db-knop ug-knop-groot ug-alleen-mobiel" onClick={() => camera.current?.click()}>
            <UgIcoon naam="camera" grootte={16} /> Foto maken
          </button>
        </div>
      </div>
      <input ref={kiezer} type="file" accept={ACCEPT} multiple hidden onChange={gekozen} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={gekozen} />

      {items.length > 0 && (
        <ul className="ug-wachtrij" aria-live="polite">
          {items.map((it) => (
            <li key={it.sleutel} className={`ug-wacht is-${it.fase}`}>
              <span className="ug-wacht-stip" aria-hidden="true" />
              <span className="ug-wacht-naam">{it.naam}</span>
              <span className="ug-wacht-fase">{it.fase === 'fout' ? it.fout || FASE_TEKST.fout : FASE_TEKST[it.fase]}</span>
              {it.fase === 'fout' && (
                <button type="button" className="ag-chip-x" aria-label="Melding weghalen" onClick={() => onWis(it.sleutel)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
