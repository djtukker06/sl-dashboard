// Veilig een pagina of afbeelding van internet ophalen voor de social-tool (links).
// Bescherming tegen SSRF: de URL wordt vooraf gecontroleerd (links-kern.ts) en elke
// DNS-resolutie gaat via een eigen lookup die alleen openbare adressen doorlaat
// (isPubliekAdres, ook voor IPv6 en IPv4-in-IPv6). Omdat de verbinding precies het
// gecontroleerde adres gebruikt, helpt DNS-rebinding niet. Redirects volgen we zelf,
// en elke stap wordt opnieuw gecontroleerd. Verder: tijdslimiet en maximale grootte.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { isPubliekAdres } from "@/lib/mail/netwerk";
import { controleerLinkUrl, isPubliekIp, LinkFout } from "./links-kern";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type Opgehaald = { url: string; status: number; contentType: string; body: Buffer; afgekapt: boolean };

type Opties = {
  /** Accept-header (pagina of afbeelding). */
  accept: string;
  /** Maximaal aantal bytes (na uitpakken). */
  maxBytes: number;
  /** Totale tijd inclusief redirects. */
  timeoutMs: number;
  /** true: bij te veel bytes afkappen in plaats van een fout (handig voor HTML). */
  afkappen?: boolean;
  maxRedirects?: number;
  signal?: AbortSignal;
};

/** DNS-lookup die alleen openbare adressen teruggeeft; anders een LinkFout. */
const veiligeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, adressen) => {
    if (err) {
      callback(new LinkFout("Deze website bestaat niet (de domeinnaam is onbekend)."), "", 4);
      return;
    }
    const lijst = adressen.filter((a) => !options.family || a.family === options.family);
    if (!lijst.length || lijst.some((a) => !isPubliekIp(a.address, isPubliekAdres))) {
      callback(new LinkFout("Deze link wijst naar een intern netwerkadres en wordt niet opgehaald."), "", 4);
      return;
    }
    if (options.all) (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, lijst);
    else callback(null, lijst[0].address, lijst[0].family);
  });
};

function uitpakker(encoding: string): NodeJS.ReadWriteStream | null {
  const e = encoding.toLowerCase().trim();
  if (e === "gzip" || e === "x-gzip") return zlib.createGunzip();
  if (e === "deflate") return zlib.createInflate();
  if (e === "br") return zlib.createBrotliDecompress();
  return null;
}

/** Eén verzoek zonder redirects te volgen. */
function verzoek(url: URL, opties: Opties, deadline: number): Promise<Opgehaald & { locatie?: string }> {
  return new Promise((klaarMet, faal) => {
    const resterend = deadline - Date.now();
    if (resterend <= 0) return faal(new LinkFout("De website reageerde niet op tijd."));
    // `timer` wordt verderop gezet; resolve/reject worden pas daarna aangeroepen.
    const resolve = (r: Opgehaald & { locatie?: string }) => {
      clearTimeout(timer);
      klaarMet(r);
    };
    const reject = (err: unknown) => {
      clearTimeout(timer);
      faal(err);
    };
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: veiligeLookup,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: opties.accept,
          "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
        signal: opties.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] || "");
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ url: url.href, status, contentType, body: Buffer.alloc(0), afgekapt: false, locatie: res.headers.location });
          return;
        }
        const gemeld = Number(res.headers["content-length"] || 0);
        if (!opties.afkappen && gemeld > opties.maxBytes) {
          res.destroy();
          reject(new LinkFout("Het bestand is te groot om op te halen."));
          return;
        }
        const pakUit = uitpakker(String(res.headers["content-encoding"] || ""));
        const bron: NodeJS.ReadableStream = pakUit ? res.pipe(pakUit) : res;
        const delen: Buffer[] = [];
        let totaal = 0;
        let klaar = false;
        const afronden = (afgekapt: boolean) => {
          if (klaar) return;
          klaar = true;
          resolve({ url: url.href, status, contentType, body: Buffer.concat(delen), afgekapt });
        };
        bron.on("data", (stuk: Buffer) => {
          if (klaar) return;
          totaal += stuk.length;
          if (totaal > opties.maxBytes) {
            if (opties.afkappen) {
              delen.push(stuk.subarray(0, stuk.length - (totaal - opties.maxBytes)));
              afronden(true);
            } else {
              klaar = true;
              reject(new LinkFout("Het bestand is te groot om op te halen."));
            }
            res.destroy();
            return;
          }
          delen.push(stuk);
        });
        bron.on("end", () => afronden(false));
        bron.on("error", (err) => {
          if (klaar) return;
          klaar = true;
          reject(err instanceof LinkFout ? err : new LinkFout("De pagina kon niet goed worden gelezen."));
        });
      },
    );
    // Totale tijdslimiet (ook voor een server die heel langzaam blijft druppelen).
    const timer = setTimeout(() => {
      const fout = new LinkFout("De website reageerde niet op tijd.");
      req.destroy(fout);
      reject(fout);
    }, resterend);
    req.on("error", (err) => {
      if (err instanceof LinkFout) reject(err);
      else if ((err as { name?: string }).name === "AbortError") reject(new LinkFout("Het ophalen is afgebroken."));
      else if (/CERT|SSL|TLS/i.test(String((err as { code?: string }).code || err.message))) {
        reject(new LinkFout("De beveiligde verbinding met deze website is ongeldig (certificaat)."));
      } else reject(new LinkFout("De website kon niet worden bereikt."));
    });
    req.end();
  });
}

/**
 * Haalt een URL op met SSRF-bescherming, tijdslimiet, maximale grootte en hooguit
 * `maxRedirects` (standaard 5) redirects. Gooit een LinkFout met een Nederlandse melding.
 */
export async function veiligOphalen(invoer: string, opties: Opties): Promise<Opgehaald> {
  const deadline = Date.now() + opties.timeoutMs;
  let url = controleerLinkUrl(invoer, isPubliekAdres);
  for (let stap = 0; stap <= (opties.maxRedirects ?? 5); stap++) {
    const res = await verzoek(url, opties, deadline);
    if (!res.locatie) return res;
    let volgende: string;
    try {
      volgende = new URL(res.locatie, url).href;
    } catch {
      throw new LinkFout("De website stuurt door naar een ongeldig adres.");
    }
    url = controleerLinkUrl(volgende, isPubliekAdres);
  }
  throw new LinkFout("De website stuurt te vaak door.");
}

/** Nederlandse melding bij een HTTP-foutstatus. */
export function statusMelding(status: number): string {
  if (status === 401 || status === 403) return "De website weigert het ophalen (geen toegang of botbeveiliging).";
  if (status === 404 || status === 410) return "De pagina bestaat niet (meer) (404).";
  if (status === 429) return "De website krijgt te veel verzoeken. Probeer het later opnieuw.";
  if (status >= 500) return `De website heeft een storing (${status}). Probeer het later opnieuw.`;
  return `De website gaf een fout (${status}).`;
}
