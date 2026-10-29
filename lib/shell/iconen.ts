// Lijn-iconen (24×24, stroke 1.6) van de backoffice. Eén bron voor de React-rail,
// de rail in de social-HTML (railHtml) en het dashboard. Elke waarde is de
// binnenkant van een <svg viewBox="0 0 24 24">.

export type IcoonNaam = 'dashboard' | 'mail' | 'agenda' | 'factuur' | 'uitgaven' | 'social' | 'klanten' | 'bestanden' | 'scratchpad' | 'map' | 'pijl';

export const ICONEN: Record<IcoonNaam, string> = {
  dashboard:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5"/>' +
    '<rect x="13.5" y="11" width="7" height="9.5" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  agenda:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>' +
    '<path d="M8 13.5h2M14 13.5h2M8 17h2"/>',
  factuur: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  // Bonnetje met gekartelde onderrand.
  uitgaven:
    '<path d="M6 3h12v17.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  social:
    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/>' +
    '<circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>',
  // Twee personen (klant + project-trekker).
  klanten:
    '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/>' +
    '<path d="M15.5 5.2a3.3 3.3 0 0 1 0 6.6M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  // Map met een document erin (gedeelde bestanden, Google Drive).
  bestanden:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<path d="M9.5 16.5v-5h3.2l1.8 1.8v3.2z"/>',
  // Kladblok met een potlood (Scratchpad: brainstormen en ideeën uitschrijven).
  scratchpad:
    '<path d="M13 4H6.5a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2H17a2 2 0 0 0 2-2V11"/><path d="M8 10h3.5M8 13.5h6M8 17h4"/>' +
    '<path d="M17.6 3.4a1.7 1.7 0 0 1 2.4 2.4l-6 6-3 .6.6-3z"/>',
  map: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  pijl: '<path d="M5 12h14M13 6l6 6-6 6"/>'
};

/** Volledige <svg>-string; gebruikt door railHtml en (via dangerouslySetInnerHTML) React. */
export function icoonSvg(naam: IcoonNaam, grootte = 20, klasse = 'sl-icoon'): string {
  return (
    `<svg class="${klasse}" viewBox="0 0 24 24" width="${grootte}" height="${grootte}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${ICONEN[naam]}</svg>`
  );
}
