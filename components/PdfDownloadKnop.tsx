// Downloadknop naast een factuur of prijsopgave in de lijsten: slaat de PDF direct op
// (?download=1 → Content-Disposition: attachment), zonder hem eerst te openen. De naam van
// het bestand komt van de server (dezelfde als bij openen).
export function PdfDownloadKnop({ href, label }: { href: string; label: string }) {
  return (
    <a href={`${href}?download=1`} download className="download-link" title={label} aria-label={label}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 20h14" />
      </svg>
    </a>
  );
}
