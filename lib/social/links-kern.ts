// Pure delen van het ophalen van links in de social-tool: URL-controle (SSRF), het
// uitlezen van een HTML-pagina (titel, beschrijving, tekst, afbeeldingen) en het
// herkennen van afbeeldingen (type en afmetingen uit de eerste bytes).
// Zonder '@/'-imports en zonder netwerk, zodat scripts/test-social-links.mjs dit los kan
// testen. Het netwerkdeel staat in lib/social/veilig-ophalen.ts.

/** Fout met een Nederlandse melding die zo naar de gebruiker mag. */
export class LinkFout extends Error {}

/** Maximaal aantal links dat per project wordt opgehaald. */
export const MAX_LINKS = 5;
/** Maximaal aantal afbeeldingen dat per link als beeldmateriaal wordt opgeslagen. */
export const MAX_BEELDEN_PER_LINK = 6;
/** Kleinere afbeeldingen (iconen, logo's, tracking pixels) worden overgeslagen. */
export const MIN_BEELD_ZIJDE = 200;
/** Zoveel tekens paginatekst gaan mee naar de generatie. */
export const MAX_TEKST = 5000;

const GEBLOKTE_NAMEN = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/i;

/**
 * Maakt van wat de gebruiker intypt een URL: zonder schema wordt het https://.
 * Geeft null als het geen bruikbare link is.
 */
export function normaliseerLink(invoer: string): string | null {
  const s = String(invoer || "").trim();
  if (!s) return null;
  const metSchema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
  try {
    return new URL(metSchema).href;
  } catch {
    return null;
  }
}

/**
 * Controleert een link vóórdat de server hem ophaalt (SSRF): alleen http/https, geen
 * inloggegevens in de URL, alleen de standaardpoort, geen interne namen en, als de host
 * een IP-adres is, alleen openbare adressen. Na DNS-resolutie controleert
 * veilig-ophalen.ts de adressen nog een keer (`isPubliek` is isPubliekAdres uit
 * lib/mail/netwerk.ts).
 */
export function controleerLinkUrl(invoer: string, isPubliek: (ip: string) => boolean): URL {
  const href = normaliseerLink(invoer);
  if (!href) throw new LinkFout("Dit is geen geldige link.");
  const url = new URL(href);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LinkFout("Alleen links die met http:// of https:// beginnen kunnen worden opgehaald.");
  }
  if (url.username || url.password) throw new LinkFout("Links met inloggegevens erin worden niet opgehaald.");
  // De URL-parser maakt :443 bij https en :80 bij http leeg; elke andere poort is dus afwijkend.
  if (url.port) throw new LinkFout("Links met een afwijkende poort worden niet opgehaald.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new LinkFout("Dit is geen geldige link.");
  if (isIpLetterlijk(host)) {
    if (!isPubliekIp(host, isPubliek)) throw new LinkFout("Deze link wijst naar een intern netwerkadres en wordt niet opgehaald.");
    return url;
  }
  if (!host.includes(".") || GEBLOKTE_NAMEN.test(host)) {
    throw new LinkFout("Deze link wijst naar een intern netwerkadres en wordt niet opgehaald.");
  }
  return url;
}

/**
 * Zet IPv6-vormen waar een IPv4-adres in zit (::ffff:7f00:1, ::7f00:1, 6to4 2002:7f00:1::)
 * om naar het IPv4-adres, zodat de v4-regels gelden. isPubliekAdres herkent alleen de
 * schrijfwijze met punten (::ffff:127.0.0.1); de URL-parser en DNS geven de hex-vorm.
 */
export function ingebedIpv4(ip: string): string | null {
  if (!ip.includes(":")) return null;
  let canoniek: string;
  try {
    canoniek = new URL(`http://[${ip.replace(/^\[|\]$/g, "")}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const v4 = (hoog: string, laag: string) => {
    const a = parseInt(hoog, 16);
    const b = parseInt(laag, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  };
  const m = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canoniek) || /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(canoniek);
  return m ? v4(m[1], m[2]) : null;
}

/** isPubliekAdres plus de IPv6-vormen met een ingebed IPv4-adres. */
export function isPubliekIp(ip: string, isPubliek: (ip: string) => boolean): boolean {
  const v4 = ingebedIpv4(ip);
  return isPubliek(ip) && (v4 === null || isPubliek(v4));
}

function isIpLetterlijk(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// ---------------------------------------------------------------- HTML uitlezen

const ENTITEITEN: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", euro: "€", copy: "©",
  reg: "®", trade: "™", middot: "·", bull: "•", deg: "°", eacute: "é", egrave: "è", euml: "ë",
  ecirc: "ê", aacute: "á", agrave: "à", auml: "ä", iuml: "ï", ouml: "ö", uuml: "ü", oacute: "ó",
  ccedil: "ç", szlig: "ß", times: "×",
};

/** Zet HTML-entiteiten om naar tekens (benoemd en numeriek). */
export function decodeerEntiteiten(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (heel, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : heel;
    }
    return ENTITEITEN[code.toLowerCase()] ?? heel;
  });
}

/** Attributen van één tag (`<meta property="og:title" content="…">`), namen in kleine letters. */
export function attributen(tag: string): Record<string, string> {
  const uit: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const binnen = tag.replace(/^<\s*[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  for (const m of binnen.matchAll(re)) {
    const naam = m[1].toLowerCase();
    if (!(naam in uit)) uit[naam] = decodeerEntiteiten(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return uit;
}

const schoon = (s: string | undefined) => decodeerEntiteiten(String(s ?? "")).replace(/\s+/g, " ").trim();

/** Maakt een (relatieve) URL absoluut; alleen http/https, geen data:/blob:/javascript:. */
export function absoluteUrl(waarde: string, basis: string): string | null {
  const v = String(waarde || "").trim();
  if (!v || /^(data|blob|javascript|about):/i.test(v)) return null;
  try {
    const u = new URL(v, basis);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Kiest uit een srcset de grootste kandidaat (op breedte `w` of dichtheid `x`). */
export function grootsteUitSrcset(srcset: string): string | null {
  let beste: { url: string; maat: number } | null = null;
  // Kandidaten worden gescheiden door komma's ná een descriptor; URL's kunnen zelf komma's bevatten.
  for (const deel of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor = "1x"] = deel.trim().split(/\s+/);
    if (!url) continue;
    const m = /^(\d+(?:\.\d+)?)([wx])$/i.exec(descriptor);
    const maat = m ? Number(m[1]) * (m[2].toLowerCase() === "x" ? 1000 : 1) : 1000;
    if (!beste || maat > beste.maat) beste = { url: url.replace(/,$/, ""), maat };
  }
  return beste?.url ?? null;
}

// Bestandsnamen/paden die bijna altijd iconen, logo's of tracking zijn.
const KLEIN_BEELD = /(^|[\/_.-])(logo|icon|icons|favicon|sprite|pixel|tracking|spacer|blank|avatar|emoji|badge|loader|spinner|placeholder)([\/_.-]|\d|$)/i;

function bruikbaarBeeld(url: string) {
  const pad = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/\.(svg|ico|avif)$/.test(pad)) return false;
  return !KLEIN_BEELD.test(pad);
}

/** Verwijdert complete blokken (`<script>…</script>`) uit de HTML. */
function zonderBlokken(html: string, tags: string[]) {
  let uit = html;
  for (const t of tags) uit = uit.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), " ");
  return uit;
}

/** Leesbare tekst uit een stuk HTML: blokelementen worden regels, de rest valt weg. */
export function tekstUitHtml(html: string): string {
  const s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|figure|figcaption|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeerEntiteiten(s)
    .split("\n")
    .map((r) => r.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export type Pagina = {
  titel: string;
  beschrijving: string;
  site: string;
  tekst: string;
  /** Absolute URL's van kandidaat-afbeeldingen, de beste eerst. */
  afbeeldingen: string[];
};

/** Haalt titel, beschrijving, hoofdtekst en afbeeldingen uit een HTML-pagina. */
export function leesPagina(html: string, basisUrl: string): Pagina {
  const zonderCommentaar = html.replace(/<!--[\s\S]*?-->/g, " ");
  // <base href> bepaalt waar relatieve URL's naartoe wijzen.
  const baseTag = /<base\b[^>]*>/i.exec(zonderCommentaar);
  const basis = (baseTag && absoluteUrl(attributen(baseTag[0]).href || "", basisUrl)) || basisUrl;

  const meta: Record<string, string> = {};
  for (const m of zonderCommentaar.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributen(m[0]);
    const sleutel = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (sleutel && a.content && !(sleutel in meta)) meta[sleutel] = a.content;
  }
  const titelTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(zonderCommentaar)?.[1];
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(zonderCommentaar)?.[1];

  const titel = schoon(meta["og:title"] || meta["twitter:title"] || titelTag || (h1 && tekstUitHtml(h1)));
  const beschrijving = schoon(meta["og:description"] || meta["twitter:description"] || meta.description);
  const site = schoon(meta["og:site_name"] || meta["application-name"]);

  // Afbeeldingen: eerst wat de pagina zelf als deelbeeld opgeeft, daarna grote <img>'s.
  const kandidaten: string[] = [];
  const voeg = (waarde: string | null | undefined) => {
    const url = waarde ? absoluteUrl(waarde, basis) : null;
    if (url && bruikbaarBeeld(url) && !kandidaten.includes(url)) kandidaten.push(url);
  };
  for (const k of ["og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src", "image"]) voeg(meta[k]);
  for (const m of zonderCommentaar.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributen(m[0]);
    if ((a.rel || "").toLowerCase() === "image_src") voeg(a.href);
  }
  const lichaam = zonderBlokken(zonderCommentaar, ["script", "style", "noscript", "template", "svg"]);
  for (const m of lichaam.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const a = attributen(m[0]);
    const breedte = parseInt(a.width || "", 10);
    const hoogte = parseInt(a.height || "", 10);
    if ((breedte && breedte < MIN_BEELD_ZIJDE) || (hoogte && hoogte < MIN_BEELD_ZIJDE)) continue;
    if (/^(presentation|none)$/i.test(a.role || "") || a["aria-hidden"] === "true") continue;
    const srcset = a["data-srcset"] || a.srcset || "";
    voeg((srcset && grootsteUitSrcset(srcset)) || a["data-src"] || a["data-lazy-src"] || a["data-original"] || a.src);
  }

  // Hoofdtekst: <main> of <article> als die er is, anders de body; zonder menu's en voeten.
  const zonderRuis = zonderBlokken(lichaam, ["nav", "header", "footer", "aside", "form", "iframe", "button", "select", "dialog"]);
  const hoofd =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(zonderRuis)?.[1] ||
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(zonderRuis)?.[1] ||
    /<body\b[^>]*>([\s\S]*)/i.exec(zonderRuis)?.[1] ||
    zonderRuis;
  let tekst = tekstUitHtml(hoofd);
  if (tekst.length > MAX_TEKST) tekst = `${tekst.slice(0, MAX_TEKST).replace(/\s+\S*$/, "")} …`;

  return { titel: titel.slice(0, 300), beschrijving: beschrijving.slice(0, 600), site: site.slice(0, 120), tekst, afbeeldingen: kandidaten.slice(0, 40) };
}

/** Tekenset uit de Content-Type-header of een <meta charset> in de eerste bytes. */
export function tekenset(contentType: string, begin: Buffer): string {
  const uitHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (uitHeader) return uitHeader.toLowerCase();
  const kop = begin.subarray(0, 2048).toString("latin1");
  const uitMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(kop)?.[1];
  return (uitMeta || "utf-8").toLowerCase();
}

/** Decodeert de HTML-bytes met de juiste tekenset (onbekende tekenset: utf-8). */
export function decodeerHtml(bytes: Buffer, contentType: string): string {
  try {
    return new TextDecoder(tekenset(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------------------------------------------------------------- afbeeldingen herkennen

export type BeeldSoort = "png" | "jpg" | "gif" | "webp";
export type BeeldInfo = { soort: BeeldSoort; breedte: number; hoogte: number };

/**
 * Herkent PNG, JPEG, GIF en WebP aan de eerste bytes en leest de afmetingen uit.
 * Alles wat geen van deze vier is (SVG, AVIF, HTML-foutpagina's) geeft null: de bucket
 * social-assets accepteert alleen deze typen (0017_social_storage_limieten.sql).
 */
export function herkenBeeld(b: Buffer): BeeldInfo | null {
  if (b.length < 24) return null;
  // PNG: handtekening + IHDR
  if (b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return { soort: "png", breedte: b.readUInt32BE(16), hoogte: b.readUInt32BE(20) };
  }
  // GIF87a / GIF89a
  if (b.toString("ascii", 0, 4) === "GIF8") {
    return { soort: "gif", breedte: b.readUInt16LE(6), hoogte: b.readUInt16LE(8) };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" && b.length >= 30) {
    const blok = b.toString("ascii", 12, 16);
    if (blok === "VP8 ") return { soort: "webp", breedte: b.readUInt16LE(26) & 0x3fff, hoogte: b.readUInt16LE(28) & 0x3fff };
    if (blok === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { soort: "webp", breedte: (bits & 0x3fff) + 1, hoogte: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (blok === "VP8X") return { soort: "webp", breedte: b.readUIntLE(24, 3) + 1, hoogte: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: zoek het SOF-segment met de afmetingen
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const lengte = b.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { soort: "jpg", breedte: b.readUInt16BE(i + 7), hoogte: b.readUInt16BE(i + 5) };
      i += 2 + lengte;
    }
    return null;
  }
  return null;
}

/** Hostnaam zonder www., voor notities en bestandsnamen ("studio-levant.nl"). */
export function korteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
