// Profielfoto's (migratie 0039): regels voor uploaden, opslaan en tonen. Geen imports: de
// browser, de server en scripts/test-team.mjs gebruiken dit bestand alle drie.
//
// Opslag: privé-bucket "profielfotos", pad "<user-id>/<tijdstempel>.<ext>", het pad in
// profiles.foto_pad. Het tijdstempel is meteen de versie in de URL (?v=…), zodat de browser
// een foto lang mag bewaren en een nieuwe foto toch meteen zichtbaar is.

export const FOTO_BUCKET = 'profielfotos';
/** Zelfde grens als de bucket (2 MB). De browser verkleint vooraf tot ±50 kB. */
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;
/** De browser snijdt bij tot een vierkant van hoogstens zoveel pixels. */
export const FOTO_MAX_PX = 512;
/** Class van de <img> in een avatar (public/shell/shell.css); gedeeld door beide rails. */
export const AVATAR_FOTO_KLASSE = 'sl-avatar-foto';

export type FotoSoort = 'image/jpeg' | 'image/png' | 'image/webp';

const EXTENSIE: Record<FotoSoort, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Het echte beeldformaat uit de eerste bytes (niet de mime-kop van de browser), of null. */
export function fotoSoort(b: Uint8Array): FotoSoort | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Controleert een upload: grootte en echt beeldformaat. */
export function valideerFoto(b: Uint8Array): { ok: true; soort: FotoSoort } | { ok: false; fout: string } {
  if (b.length === 0) return { ok: false, fout: 'Kies een foto.' };
  if (b.length > FOTO_MAX_BYTES) return { ok: false, fout: 'De foto is te groot (maximaal 2 MB).' };
  const soort = fotoSoort(b);
  if (!soort) return { ok: false, fout: 'Dit is geen JPG-, PNG- of WebP-afbeelding.' };
  return { ok: true, soort };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PAD = new RegExp(`^(${UUID})/(\\d{10,16})\\.(webp|jpg|png)$`, 'i');

/** Nieuw opslagpad voor de foto van deze gebruiker. */
export function nieuwFotoPad(userId: string, soort: FotoSoort, nu = Date.now()): string {
  return `${userId.toLowerCase()}/${Math.floor(nu)}.${EXTENSIE[soort]}`;
}

/** Hoort dit pad bij deze gebruiker (en heeft het de vorm die de app zelf maakt)? */
export function fotoPadVan(pad: unknown, userId: string): pad is string {
  if (typeof pad !== 'string') return false;
  const m = PAD.exec(pad);
  return Boolean(m && m[1].toLowerCase() === userId.toLowerCase());
}

/** De versie (het tijdstempel) uit een geldig pad, of null. */
export function fotoVersie(pad: unknown): string | null {
  if (typeof pad !== 'string') return null;
  return PAD.exec(pad)?.[2] ?? null;
}

/** De URL waaronder de app de foto van een teamlid toont, of null zonder (geldige) foto. */
export function fotoUrl(userId: string, pad: unknown): string | null {
  if (!fotoPadVan(pad, userId)) return null;
  return `/api/team/foto/${userId.toLowerCase()}?v=${fotoVersie(pad)}`;
}
