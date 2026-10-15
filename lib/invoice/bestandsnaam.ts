// Maakt van een zelfgekozen factuurnaam een bruikbare bestandsnaam: stuurtekens eruit,
// tekens die Windows/macOS niet in bestandsnamen toestaan vervangen door een streepje.
export function veiligeBestandsnaam(naam: string, terugval: string): string {
  const zonderStuurtekens = [...naam]
    .filter((teken) => {
      const code = teken.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const opgeschoond = zonderStuurtekens
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    // Een punt aan het eind is op Windows niet toegestaan.
    .replace(/\.+$/, '')
    .trim();

  return `${opgeschoond || terugval}.pdf`;
}

// "inline" houdt het gedrag zoals het was: de PDF opent gewoon in de browser, en bij
// opslaan staat de juiste naam er al klaar.
export function pdfHeaders(bestandsnaam: string): HeadersInit {
  const asciiNaam = bestandsnaam.replace(/[^ -~]/g, '_');
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${asciiNaam}"; filename*=UTF-8''${encodeURIComponent(bestandsnaam)}`,
    'Cache-Control': 'private, no-store'
  };
}
