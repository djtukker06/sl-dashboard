import type { BestandSoort } from '@/lib/drive/weergave';

// Lijn-iconen (24×24, stroke 1.6) voor de module Bestanden, in de stijl van lib/shell/iconen.ts.

const PADEN: Record<BestandSoort | 'zoek' | 'upload' | 'raster' | 'lijst' | 'nieuwemap' | 'drive' | 'download' | 'pen' | 'prullenbak' | 'extern' | 'sluit', string> = {
  map: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  afbeelding: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L6 19.5"/>',
  pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 16.5h1.2a1.3 1.3 0 0 0 0-2.6H9.5V18M14 13.9V18h1a2 2 0 0 0 0-4.1z"/>',
  document: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 12h6M10 15h6M10 18h4"/>',
  spreadsheet: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 12h7v6h-7zM9.5 15h7M13 12v6"/>',
  presentatie: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><rect x="9.5" y="12" width="7" height="5" rx=".6"/>',
  video: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  archief: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M11 6h1M11 9h1M11 12h1M10.5 15h2v3h-2z"/>',
  tekst: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 16h6"/>',
  bestand: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  zoek: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  raster: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
  lijst: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
  nieuwemap: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  drive: '<path d="m8.5 4h7l6 10.5-3.5 6h-12L2.5 14.5z"/><path d="m8.5 4 6 10.5h7M15.5 4l-9.5 16.5M2.5 14.5h12"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  prullenbak: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  extern: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sluit: '<path d="M6 6l12 12M18 6 6 18"/>'
};

export type BsIcoonNaam = keyof typeof PADEN;

export function BsIcoon({ naam, grootte = 18, className }: { naam: BsIcoonNaam; grootte?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={grootte}
      height={grootte}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PADEN[naam] }}
    />
  );
}
