// Browser: HEIC/HEIF (iPhone-foto's) decoderen met libheif-js (wasm, LGPL-3.0). Wordt alleen
// dynamisch geïmporteerd vanuit lib/uitgaven/client.ts als de browser de foto zelf niet kan
// lezen (Chrome, Firefox, Edge); Safari decodeert HEIC zelf en komt hier niet. De ~2 MB aan
// wasm komt zo nooit in de hoofdbundel. Rotatie/spiegeling uit het bestand past libheif toe.
// Bewust zonder '@/'-imports: scripts/test-bonnetje-heic.mjs laadt dit bestand in Chrome.

let lib: Promise<LibHeif.Module> | null = null;
function laad(): Promise<LibHeif.Module> {
  lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  lib.catch(() => (lib = null));
  return lib;
}

let wachtrij: Promise<unknown> = Promise.resolve();

/** Decodeert een HEIC/HEIF-bestand naar een canvas op ware grootte (één tegelijk). */
export function heicNaarCanvas(bestand: Blob): Promise<HTMLCanvasElement> {
  const taak = async () => {
    const [module, inhoud] = await Promise.all([laad(), bestand.arrayBuffer()]);
    const beelden = new module.HeifDecoder().decode(new Uint8Array(inhoud));
    if (!beelden?.length) throw new Error('Geen afbeelding gevonden in dit HEIC-bestand.');
    const beeld = beelden.find((b) => b.is_primary()) ?? beelden[0];
    const width = beeld.get_width();
    const height = beeld.get_height();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('geen canvas');
    const pixels = ctx.createImageData(width, height);
    const ok = await new Promise<boolean>((klaar) => {
      try {
        beeld.display(pixels, (r) => klaar(Boolean(r)));
      } catch {
        klaar(false);
      }
    });
    for (const b of beelden) {
      try {
        b.free();
      } catch {
        /* al vrijgegeven */
      }
    }
    if (!ok) throw new Error('Dit HEIC-bestand kon niet worden gedecodeerd.');
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  };
  const r = wachtrij.then(taak, taak);
  wachtrij = r.catch(() => undefined);
  return r;
}
