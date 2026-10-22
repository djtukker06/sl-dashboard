import { ICONEN } from '@/lib/shell/iconen';

// Lijn-iconen voor de uitgavenmodule, zelfde stijl als de rail (24×24, stroke 1.6).
const PADEN = {
  bon: ICONEN.uitgaven,
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  zoek: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  links: '<path d="m15 5-7 7 7 7"/>',
  rechts: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
  beeld: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5L5 20"/>',
  vonk: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  kruis: '<path d="M6 6l12 12M18 6 6 18"/>',
  vink: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  raster: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  lijst: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r=".9"/><circle cx="5" cy="12" r=".9"/><circle cx="5" cy="18" r=".9"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'
} as const;

export type UgIcoonNaam = keyof typeof PADEN;

export function UgIcoon({ naam, grootte = 18, className }: { naam: UgIcoonNaam; grootte?: number; className?: string }) {
  return (
    <svg
      className={className ?? 'ug-icoon'}
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
