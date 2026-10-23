// Weergave-hulpjes voor bestanden (client én server; geen imports).

export type BestandSoort = 'map' | 'afbeelding' | 'pdf' | 'document' | 'spreadsheet' | 'presentatie' | 'video' | 'audio' | 'archief' | 'tekst' | 'bestand';

export function soortVan(mime: string, naam = ''): BestandSoort {
  const m = (mime || '').toLowerCase();
  const ext = (naam.split('.').pop() || '').toLowerCase();
  if (m === 'application/vnd.google-apps.folder') return 'map';
  if (m.startsWith('image/')) return 'afbeelding';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (/spreadsheet|excel|csv/.test(m) || ['xlsx', 'xls', 'csv', 'numbers'].includes(ext)) return 'spreadsheet';
  if (/presentation|powerpoint|slides/.test(m) || ['pptx', 'ppt', 'key'].includes(ext)) return 'presentatie';
  if (/document|msword|wordprocessing|opendocument\.text/.test(m) || ['docx', 'doc', 'pages', 'odt', 'rtf'].includes(ext)) return 'document';
  if (/zip|compressed|tar|rar|7z/.test(m) || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archief';
  if (m.startsWith('text/') || ['txt', 'md'].includes(ext)) return 'tekst';
  return 'bestand';
}

/** Kan het in het dashboard bekeken worden (via de proxy-route)? */
export function isVoorbeeldbaar(mime: string, naam = ''): boolean {
  const s = soortVan(mime, naam);
  if (s === 'afbeelding') return /^image\/(jpeg|png|gif|webp|avif|bmp)$/i.test(mime);
  return s === 'pdf' || isGoogleDocument(mime);
}

/** Google Docs/Sheets/Slides: geen bytes, wel als PDF te exporteren. */
export function isGoogleDocument(mime: string): boolean {
  return /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/.test(mime);
}

export function grootteTekst(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const eenheden = ['KB', 'MB', 'GB', 'TB'];
  let w = bytes / 1024;
  let i = 0;
  while (w >= 1024 && i < eenheden.length - 1) {
    w /= 1024;
    i++;
  }
  return `${w.toLocaleString('nl-NL', { maximumFractionDigits: w < 10 ? 1 : 0 })} ${eenheden[i]}`;
}

/** "vandaag 14:05", "gisteren", "12 mrt", "12 mrt 2024". */
export function gewijzigdTekst(iso: string | null | undefined, nu: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = 'Europe/Amsterdam';
  const dag = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
  const gisteren = new Date(nu.getTime() - 86400000);
  if (dag(d) === dag(nu)) return `vandaag ${new Intl.DateTimeFormat('nl-NL', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d)}`;
  if (dag(d) === dag(gisteren)) return 'gisteren';
  const zelfdeJaar = dag(d).slice(0, 4) === dag(nu).slice(0, 4);
  return new Intl.DateTimeFormat('nl-NL', { timeZone: tz, day: 'numeric', month: 'short', ...(zelfdeJaar ? {} : { year: 'numeric' }) })
    .format(d)
    .replace('.', '');
}

/**
 * Mag de proxy dit inline (in de browser) tonen? Alleen afbeeldingen zonder script en PDF.
 * Al het andere (ook SVG en HTML, die script kunnen bevatten) gaat als download.
 */
export function veiligInline(mime: string): boolean {
  return /^(image\/(jpeg|png|gif|webp|avif|bmp)|application\/pdf)$/i.test(mime);
}
