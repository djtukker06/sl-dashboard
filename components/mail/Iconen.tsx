// Lijn-iconen voor de mailmodule, in dezelfde stijl als de rail (lib/shell/iconen.ts):
// 24×24, stroke 1.6, afgeronde uiteinden.

const PADEN = {
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>',
  verzonden: '<path d="m21 3-9.5 9.5"/><path d="M21 3 14.5 21l-3-8.5L3 9.5z"/>',
  concepten: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  archief: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  spam: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>',
  prullenbak: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  map: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  antwoord: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/>',
  allen: '<path d="M8 7l-5 5 5 5"/><path d="M12 7l-5 5 5 5"/><path d="M7 12h8a6 6 0 0 1 6 6v1"/>',
  doorsturen: '<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0-6 6v1"/>',
  ongelezen: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  vlag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
  clip: '<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  ververs: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  terug: '<path d="m15 5-7 7 7 7"/>',
  taak: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
  zoek: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  kruis: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pijlOmlaag: '<path d="m6 9 6 6 6-6"/>',
  beeld: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5L5 20"/>',
  gedeeld: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6"/><path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8"/>',
  bestand: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
} as const;

export type MailIcoonNaam = keyof typeof PADEN;

export function Icoon({ naam, grootte = 18, className }: { naam: MailIcoonNaam; grootte?: number; className?: string }) {
  return (
    <svg
      className={className ?? 'ml-icoon'}
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
