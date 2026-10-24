import { decode as jpegDecode, encode as jpegEncode } from 'jpeg-js';
import { snuffelType } from './model';

// Foto's op de server: HEIC/HEIF omzetten naar JPEG en afbeeldingen klaarmaken voor Claude.
// Alles in pure JS/wasm (geen native binaries, dus geen verrassingen op Vercel):
//   - HEIC/HEIF: libheif-js (wasm, LGPL-3.0; de wasm zit in de .js zelf, geen los bestand).
//     De prebuilt sharp kan GEEN HEIC lezen (libvips zonder HEVC-decoder, alleen AVIF).
//   - JPEG lezen/schrijven: jpeg-js (BSD-3-Clause). EXIF-oriëntatie wordt toegepast, zodat
//     een liggend gefotografeerde bon rechtop bij Claude aankomt.
//   - verkleinen (gemiddelde over het gebied, scherp genoeg voor bonnetjestekst) en knippen
//     doen we zelf op de RGBA-pixels.
// Bewust zonder '@/'-imports: scripts/test-bonnetje-heic.mjs laadt dit bestand los.

/** RGBA, rij voor rij. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type BeeldFoutCode = 'onleesbaar' | 'te_groot' | 'onbekend_formaat';

/** Een foto die we niet kunnen lezen; de melding is in gewone taal. */
export class BeeldFout extends Error {
  code: BeeldFoutCode;
  constructor(code: BeeldFoutCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const MELDING_HEIC_ONLEESBAAR =
  'Deze iPhone-foto (HEIC) kon niet worden gelezen; het bestand is mogelijk beschadigd. Maak een nieuwe foto, of exporteer hem als JPEG en upload die.';
export const MELDING_FOTO_ONLEESBAAR =
  'Deze foto kon niet worden gelezen; het bestand is mogelijk beschadigd of in een onbekend formaat. Upload hem opnieuw als JPEG of PDF.';

/** Normale foto's: langste zijde max. 2400 px (zelfde als de browser). */
export const MAX_ZIJDE = 2400;
/** Lange, smalle bon (verhouding ≥ LANG): meer pixels houden, zodat de tekst leesbaar blijft. */
export const MAX_ZIJDE_LANG = 4000;
export const LANG = 2.2;
/** Anthropic weigert afbeeldingen boven 5 MB (gemeten als base64). */
const MAX_BEELD_BASE64 = 5 * 1024 * 1024;
/** Beschermt tegen gigantische afbeeldingen (geheugen): 60 MP is ruim voor elke telefoon. */
const MAX_MP = 60;

export const isHeicType = (t: string | null | undefined) => t === 'image/heic' || t === 'image/heif';

/** Langste zijde voor opslag/upload: 2400 px, of 4000 px voor een lange smalle bon. */
export function maxZijdeVoor(width: number, height: number): number {
  const lang = Math.max(width, height);
  const kort = Math.max(1, Math.min(width, height));
  return lang / kort >= LANG ? MAX_ZIJDE_LANG : MAX_ZIJDE;
}

// ---------- HEIC/HEIF ----------

let libheif: Promise<LibHeif.Module> | null = null;
function laadLibheif(): Promise<LibHeif.Module> {
  // Pas laden als er echt een HEIC is (2 MB JS + wasm-compilatie).
  // CommonJS via import(): afhankelijk van de lader zit het module-object direct of onder default.
  libheif ??= import('libheif-js/wasm-bundle.js').then((m) => {
    const d = (m as { default?: { default?: unknown } }).default;
    const lib = [m, d, d?.default].find((k) => typeof (k as Partial<LibHeif.Module> | undefined)?.HeifDecoder === 'function');
    if (!lib) throw new Error('libheif-js: geen HeifDecoder gevonden');
    return lib as LibHeif.Module;
  });
  libheif.catch(() => (libheif = null));
  return libheif;
}

// Eén decodering tegelijk: libheif hergebruikt zijn context en display() is asynchroon.
let wachtrij: Promise<unknown> = Promise.resolve();
function naElkaar<T>(fn: () => Promise<T>): Promise<T> {
  const r = wachtrij.then(fn, fn);
  wachtrij = r.catch(() => undefined);
  return r;
}

/** HEIC/HEIF → RGBA (rotatie/spiegeling uit het bestand toegepast). */
export function decodeerHeic(inhoud: Uint8Array): Promise<Raster> {
  return naElkaar(async () => {
    let lib: LibHeif.Module;
    try {
      lib = await laadLibheif();
    } catch (e) {
      console.error('[uitgaven] libheif laden mislukt', (e as Error)?.message ?? e);
      throw new BeeldFout('onleesbaar', MELDING_HEIC_ONLEESBAAR);
    }
    const beelden = new lib.HeifDecoder().decode(inhoud);
    if (!beelden?.length) throw new BeeldFout('onleesbaar', MELDING_HEIC_ONLEESBAAR);
    const beeld = beelden.find((b) => b.is_primary()) ?? beelden[0];
    const width = beeld.get_width();
    const height = beeld.get_height();
    if (!width || !height || (width * height) / 1e6 > MAX_MP) {
      throw new BeeldFout('te_groot', 'Deze foto is te groot om te verwerken.');
    }
    const pixels = await new Promise<LibHeif.Pixels | null>((klaar) => {
      try {
        beeld.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, klaar);
      } catch {
        klaar(null);
      }
    });
    for (const b of beelden) {
      try {
        b.free();
      } catch {
        /* al vrijgegeven */
      }
    }
    if (!pixels) throw new BeeldFout('onleesbaar', MELDING_HEIC_ONLEESBAAR);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  });
}

// ---------- JPEG ----------

/** EXIF-oriëntatie (1–8) uit een JPEG; 1 als er niets (geldigs) staat. */
export function exifOrientatie(b: Uint8Array): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) return 1; // beeldgegevens: geen EXIF meer
    const lengte = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && lengte >= 16) {
      const s = i + 4;
      const isExif = b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66 && b[s + 4] === 0 && b[s + 5] === 0;
      if (isExif) {
        const t = s + 6; // TIFF-kop
        const klein = b[t] === 0x49 && b[t + 1] === 0x49;
        const u16 = (p: number) => (klein ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
        const u32 = (p: number) => (klein ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
        const ifd = t + u32(t + 4);
        if (ifd + 2 > b.length) return 1;
        const aantal = u16(ifd);
        for (let n = 0; n < aantal; n++) {
          const e = ifd + 2 + n * 12;
          if (e + 12 > b.length) return 1;
          if (u16(e) === 0x0112) {
            const o = u16(e + 8);
            return o >= 1 && o <= 8 ? o : 1;
          }
        }
        return 1;
      }
    }
    i += 2 + lengte;
  }
  return 1;
}

/** Draait/spiegelt volgens EXIF-oriëntatie, zodat het beeld rechtop staat. */
export function orienteer(r: Raster, o: number): Raster {
  if (o <= 1 || o > 8) return r;
  const { width: w, height: h, data } = r;
  const wissel = o >= 5;
  const nw = wissel ? h : w;
  const nh = wissel ? w : h;
  const uit = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x; ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        default: nx = y; ny = w - 1 - x; break; // 8
      }
      const van = (y * w + x) * 4;
      const naar = (ny * nw + nx) * 4;
      uit[naar] = data[van];
      uit[naar + 1] = data[van + 1];
      uit[naar + 2] = data[van + 2];
      uit[naar + 3] = data[van + 3];
    }
  }
  return { width: nw, height: nh, data: uit };
}

/** JPEG → RGBA, rechtop gezet volgens EXIF. */
export function decodeerJpeg(inhoud: Uint8Array): Raster {
  try {
    const r = jpegDecode(inhoud, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MP, maxMemoryUsageInMB: 1024 });
    return orienteer({ width: r.width, height: r.height, data: r.data }, exifOrientatie(inhoud));
  } catch (e) {
    throw new BeeldFout('onleesbaar', `${MELDING_FOTO_ONLEESBAAR} (${(e as Error)?.message ?? 'jpeg'})`);
  }
}

export function naarJpeg(r: Raster, kwaliteit = 88): Buffer {
  const uit = jpegEncode({ width: r.width, height: r.height, data: r.data }, kwaliteit);
  return Buffer.from(uit.data);
}

// ---------- verkleinen en knippen ----------

/** Per doelpixel: eerste bronpixel en gewichten (gemiddelde over het bedekte gebied). */
function bijdragen(bron: number, doel: number): { start: Int32Array; aantal: Int32Array; gewicht: Float32Array; breedte: number } {
  const schaal = bron / doel;
  const breedte = Math.ceil(schaal) + 2;
  const start = new Int32Array(doel);
  const aantal = new Int32Array(doel);
  const gewicht = new Float32Array(doel * breedte);
  for (let i = 0; i < doel; i++) {
    const a = i * schaal;
    const b = Math.min(bron, (i + 1) * schaal);
    const s = Math.floor(a);
    let n = 0;
    for (let p = s; p < b && n < breedte; p++, n++) {
      gewicht[i * breedte + n] = (Math.min(b, p + 1) - Math.max(a, p)) / schaal;
    }
    start[i] = s;
    aantal[i] = n;
  }
  return { start, aantal, gewicht, breedte };
}

/** Verkleint tot de langste zijde maxZijde is (nooit vergroten). */
export function verklein(r: Raster, maxZijde: number): Raster {
  const s = Math.min(1, maxZijde / Math.max(r.width, r.height));
  if (s >= 1) return r;
  const w = Math.max(1, Math.round(r.width * s));
  const h = Math.max(1, Math.round(r.height * s));
  // Eerst horizontaal (w × bronhoogte), dan verticaal.
  const hx = bijdragen(r.width, w);
  const tmp = new Uint8Array(w * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const rij = y * r.width * 4;
    for (let x = 0; x < w; x++) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      const st = hx.start[x];
      for (let k = 0; k < hx.aantal[x]; k++) {
        const g = hx.gewicht[x * hx.breedte + k];
        const p = rij + (st + k) * 4;
        c0 += r.data[p] * g;
        c1 += r.data[p + 1] * g;
        c2 += r.data[p + 2] * g;
        c3 += r.data[p + 3] * g;
      }
      const q = (y * w + x) * 4;
      tmp[q] = c0 + 0.5;
      tmp[q + 1] = c1 + 0.5;
      tmp[q + 2] = c2 + 0.5;
      tmp[q + 3] = c3 + 0.5;
    }
  }
  const vy = bijdragen(r.height, h);
  const uit = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const st = vy.start[y];
    for (let x = 0; x < w; x++) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      for (let k = 0; k < vy.aantal[y]; k++) {
        const g = vy.gewicht[y * vy.breedte + k];
        const p = ((st + k) * w + x) * 4;
        c0 += tmp[p] * g;
        c1 += tmp[p + 1] * g;
        c2 += tmp[p + 2] * g;
        c3 += tmp[p + 3] * g;
      }
      const q = (y * w + x) * 4;
      uit[q] = c0 + 0.5;
      uit[q + 1] = c1 + 0.5;
      uit[q + 2] = c2 + 0.5;
      uit[q + 3] = c3 + 0.5;
    }
  }
  return { width: w, height: h, data: uit };
}

/** Een rechthoek uit het beeld. */
export function knip(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const uit = new Uint8Array(w * h * 4);
  for (let rij = 0; rij < h; rij++) {
    const van = ((y + rij) * r.width + x) * 4;
    uit.set(r.data.subarray(van, van + w * 4), rij * w * 4);
  }
  return { width: w, height: h, data: uit };
}

// ---------- publieke functies ----------

/** Decodeert een HEIC/HEIF of JPEG naar RGBA (rechtop). Andere formaten: null. */
export async function decodeer(inhoud: Uint8Array): Promise<Raster | null> {
  const type = snuffelType(inhoud.subarray(0, 16));
  if (isHeicType(type)) return decodeerHeic(inhoud);
  if (type === 'image/jpeg') return decodeerJpeg(inhoud);
  return null;
}

/**
 * HEIC/HEIF → JPEG om op te slaan (vervangt het origineel, zodat elke browser hem kan
 * tonen en Claude hem kan lezen). Max. 2400 px, of 4000 px voor een lange smalle bon.
 */
export async function heicNaarJpeg(inhoud: Uint8Array): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const r = await decodeerHeic(inhoud);
  const klein = verklein(r, maxZijdeVoor(r.width, r.height));
  return { jpeg: naarJpeg(klein, 86), width: klein.width, height: klein.height };
}

export interface ClaudeBeeld {
  /** Korte uitleg die vóór de afbeelding in het bericht staat. */
  label: string;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  data: Buffer;
}

const past = (b: Uint8Array) => Math.ceil(b.length / 3) * 4 <= MAX_BEELD_BASE64;

/** Codeert als JPEG binnen de 5 MB van Claude (eerst minder compressie, dan kleiner). */
function jpegBinnenLimiet(r: Raster): Buffer {
  let beeld = r;
  for (let poging = 0; poging < 4; poging++) {
    for (const q of [90, 82]) {
      const b = naarJpeg(beeld, q);
      if (past(b)) return b;
    }
    beeld = verklein(beeld, Math.round(Math.max(beeld.width, beeld.height) * 0.8));
  }
  throw new BeeldFout('te_groot', 'Deze afbeelding is te groot om automatisch uit te lezen.');
}

/**
 * Maakt van een opgeslagen foto wat Claude te zien krijgt:
 *   - normaal: één afbeelding, langste zijde max. 2400 px (ruim binnen Claudes 2576 px);
 *   - een lange, smalle bon met meer pixels dan dat: de hele bon (voor logo en overzicht)
 *     plus de bovenste en onderste helft (met overlap) elk op 2400 px, zodat kleine tekst
 *     zoals het totaal en de datum scherp blijft.
 * PNG/WebP gaan ongewijzigd mee (screenshots); kunnen we een JPEG niet lezen maar is hij
 * klein genoeg, dan gaat het origineel. HEIC wordt altijd omgezet (Claude leest geen HEIC).
 */
export async function beeldenVoorClaude(inhoud: Buffer): Promise<ClaudeBeeld[]> {
  const type = snuffelType(inhoud.subarray(0, 16));
  if (type === 'image/png' || type === 'image/webp') {
    if (!past(inhoud)) throw new BeeldFout('te_groot', 'Deze afbeelding is te groot om automatisch uit te lezen.');
    return [{ label: 'De bon:', type, data: inhoud }];
  }
  let r: Raster;
  if (isHeicType(type)) {
    r = await decodeerHeic(inhoud);
  } else if (type === 'image/jpeg') {
    try {
      r = decodeerJpeg(inhoud);
    } catch (e) {
      if (past(inhoud)) return [{ label: 'De bon:', type, data: inhoud }];
      throw e;
    }
  } else {
    throw new BeeldFout('onbekend_formaat', MELDING_FOTO_ONLEESBAAR);
  }

  const lang = Math.max(r.width, r.height);
  const kort = Math.min(r.width, r.height);
  const geheel: ClaudeBeeld = { label: 'De hele bon:', type: 'image/jpeg', data: jpegBinnenLimiet(verklein(r, MAX_ZIJDE)) };
  if (lang / kort < LANG || lang <= MAX_ZIJDE * 1.15) return [geheel];

  // Twee overlappende helften langs de lange kant (elk 56%, dus 12% overlap).
  const staand = r.height >= r.width;
  const deel = Math.round(lang * 0.56);
  const tweede = lang - deel;
  const helften = staand
    ? [knip(r, 0, 0, r.width, deel), knip(r, 0, tweede, r.width, deel)]
    : [knip(r, 0, 0, deel, r.height), knip(r, tweede, 0, deel, r.height)];
  const namen = staand ? ['Bovenste deel, vergroot:', 'Onderste deel, vergroot:'] : ['Linker deel, vergroot:', 'Rechter deel, vergroot:'];
  return [
    geheel,
    ...helften.map((h, i) => ({ label: namen[i], type: 'image/jpeg' as const, data: jpegBinnenLimiet(verklein(h, MAX_ZIJDE)) }))
  ];
}
