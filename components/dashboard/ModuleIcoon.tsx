// Inline SVG-iconen voor de moduletegels op het dashboard. Een nieuw icoon toevoegen:
// breid IcoonNaam uit en voeg een entry toe aan PADEN.

export type IcoonNaam = 'factuur' | 'social' | 'map';

const PADEN: Record<IcoonNaam, React.ReactNode> = {
  factuur: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 17h6" />
    </>
  ),
  social: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </>
  ),
  map: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  )
};

export function ModuleIcoon({ naam }: { naam: IcoonNaam }) {
  return (
    <svg
      className="dash-icoon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PADEN[naam]}
    </svg>
  );
}
