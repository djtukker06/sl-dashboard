// Links in een social-project echt ophalen: de pagina wordt (veilig) gedownload, titel,
// beschrijving en tekst gaan mee naar de generatie, en de foto's van de pagina worden als
// beeldmateriaal in de eigen opslag gezet (de browser mag geen externe beelden laden, zie
// lib/auth/csp-kern.ts, en Claude krijgt ze zo net als geüploade foto's te zien).
// De resultaten staan per link in project.brief.linkInfo (jsonb, geen migratie nodig).

import crypto from "node:crypto";
import { logFout } from "@/lib/log";
import { BUCKET, db } from "./http";
import { id as randomId } from "./ids";
import {
  decodeerHtml,
  herkenBeeld,
  korteHost,
  leesPagina,
  LinkFout,
  MAX_BEELDEN_PER_LINK,
  MAX_LINKS,
  MIN_BEELD_ZIJDE,
  type BeeldSoort,
} from "./links-kern";
import { assetPath, type Asset, type Project } from "./repo";
import { statusMelding, veiligOphalen } from "./veilig-ophalen";

export type LinkInfo = {
  /** De link zoals de gebruiker hem invulde (sleutel, gelijk aan een regel uit project.links). */
  url: string;
  status: "ok" | "fout";
  /** Het uiteindelijke adres na redirects. */
  adres?: string;
  titel?: string;
  beschrijving?: string;
  site?: string;
  tekst?: string;
  /** Bestandsnamen van het opgeslagen beeldmateriaal van deze link. */
  beelden?: string[];
  fout?: string;
  opgehaaldOp: string;
};

const PAGINA_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";
// Geen AVIF/SVG vragen: de bucket accepteert alleen png, jpg, webp en gif.
const BEELD_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.3";
const MAX_HTML = 3 * 1024 * 1024;
const MAX_BEELD = 10 * 1024 * 1024;
const PAGINA_TIMEOUT = 12_000;
const BEELD_TIMEOUT = 10_000;

const MIME: Record<BeeldSoort, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** De opgeslagen link-informatie van een project (alleen geldige items). */
export function linkInfoVan(p: Project): LinkInfo[] {
  const lijst = (p.brief as { linkInfo?: unknown }).linkInfo;
  if (!Array.isArray(lijst)) return [];
  return lijst.filter(
    (l): l is LinkInfo => Boolean(l) && typeof l === "object" && typeof (l as LinkInfo).url === "string",
  );
}

function zetLinkInfo(p: Project, lijst: LinkInfo[]) {
  p.brief = { ...p.brief, linkInfo: lijst };
}

/**
 * Na het wijzigen van de links: informatie en beeldmateriaal van links die er niet meer
 * staan weghalen. De bestanden zelf blijven in de opslag, zoals bij DELETE /assets/[file]
 * (een slide kan er nog naar verwijzen).
 */
export function ruimLinksOp(p: Project) {
  const huidig = new Set(p.links);
  const info = linkInfoVan(p);
  const weg = new Set(info.filter((l) => !huidig.has(l.url)).map((l) => l.url));
  if (!weg.size) return;
  zetLinkInfo(p, info.filter((l) => huidig.has(l.url)));
  p.assets = p.assets.filter((a) => !a.bron || !weg.has(a.bron));
}

/** Links die nog niet (met succes of met een fout) zijn opgehaald. */
export function nogOpTeHalen(p: Project): string[] {
  const bekend = new Set(linkInfoVan(p).map((l) => l.url));
  return p.links.slice(0, MAX_LINKS).filter((l) => !bekend.has(l));
}

type BeeldResultaat = { bytes: Buffer; soort: BeeldSoort; hash: string };

async function haalBeeld(url: string, signal?: AbortSignal): Promise<BeeldResultaat | null> {
  try {
    const res = await veiligOphalen(url, { accept: BEELD_ACCEPT, maxBytes: MAX_BEELD, timeoutMs: BEELD_TIMEOUT, signal });
    if (res.status !== 200) return null;
    const info = herkenBeeld(res.body);
    if (!info || info.breedte < MIN_BEELD_ZIJDE || info.hoogte < MIN_BEELD_ZIJDE) return null;
    return { bytes: res.body, soort: info.soort, hash: crypto.createHash("sha1").update(res.body).digest("hex") };
  } catch {
    return null; // één beeld dat niet lukt mag de rest niet tegenhouden
  }
}

/** Downloadt de kandidaten (in kleine groepjes) tot er genoeg bruikbare beelden zijn. */
async function kiesBeelden(kandidaten: string[], signal?: AbortSignal): Promise<BeeldResultaat[]> {
  const gekozen: BeeldResultaat[] = [];
  const hashes = new Set<string>();
  const lijst = kandidaten.slice(0, 18);
  for (let i = 0; i < lijst.length && gekozen.length < MAX_BEELDEN_PER_LINK; i += 6) {
    const groep = await Promise.all(lijst.slice(i, i + 6).map((u) => haalBeeld(u, signal)));
    for (const b of groep) {
      if (!b || hashes.has(b.hash) || gekozen.length >= MAX_BEELDEN_PER_LINK) continue;
      hashes.add(b.hash);
      gekozen.push(b);
    }
  }
  return gekozen;
}

function bestandsnaam(url: string, soort: BeeldSoort) {
  const basis =
    korteHost(url)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "link";
  return `${basis}-${randomId()}.${soort}`;
}

/** Meldingen die we niet kennen (onverwachte fouten) niet letterlijk tonen. */
function melding(err: unknown) {
  if (err instanceof LinkFout) return err.message;
  logFout("[social] link ophalen", err);
  return "De pagina kon niet worden opgehaald.";
}

type Resultaat = { info: LinkInfo; assets: Asset[] };

/** Haalt één link op en zet zijn beelden in de opslag. Gooit niet: fouten staan in info. */
export async function haalLinkOp(pid: string, link: string, signal?: AbortSignal): Promise<Resultaat> {
  const opgehaaldOp = new Date().toISOString();
  try {
    const res = await veiligOphalen(link, {
      accept: PAGINA_ACCEPT,
      maxBytes: MAX_HTML,
      timeoutMs: PAGINA_TIMEOUT,
      afkappen: true,
      signal,
    });
    if (res.status !== 200) throw new LinkFout(statusMelding(res.status));
    const type = res.contentType.toLowerCase();
    if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) {
      if (type.startsWith("image/")) throw new LinkFout("Deze link is een losse afbeelding. Upload hem bij Beeldmateriaal.");
      if (type.includes("pdf")) throw new LinkFout("Deze link is een PDF; alleen webpagina's kunnen worden opgehaald.");
      throw new LinkFout("Deze link is geen webpagina.");
    }
    const pagina = leesPagina(decodeerHtml(res.body, res.contentType), res.url);
    if (!pagina.titel && !pagina.beschrijving && !pagina.tekst) {
      throw new LinkFout("Op deze pagina staat geen leesbare tekst (mogelijk wordt de inhoud pas in de browser geladen).");
    }

    const beelden = await kiesBeelden(pagina.afbeeldingen, signal);
    const opslag = db().storage.from(BUCKET);
    const host = korteHost(res.url);
    // Parallel opslaan; de volgorde van de pagina blijft behouden.
    const opgeslagen = await Promise.all(
      beelden.map(async (b): Promise<Asset | null> => {
        const file = bestandsnaam(res.url, b.soort);
        const { error } = await opslag.upload(assetPath(pid, file), b.bytes, { contentType: MIME[b.soort], upsert: false });
        if (error) {
          logFout("[social] linkbeeld opslaan", error);
          return null;
        }
        return { file, kind: "beeld", note: `Van ${host}`, bron: link };
      }),
    );
    const assets = opgeslagen.filter((a): a is Asset => a !== null);

    return {
      info: {
        url: link,
        status: "ok",
        adres: res.url,
        titel: pagina.titel,
        beschrijving: pagina.beschrijving,
        site: pagina.site || host,
        tekst: pagina.tekst,
        beelden: assets.map((a) => a.file),
        opgehaaldOp,
      },
      assets,
    };
  } catch (err) {
    return { info: { url: link, status: "fout", fout: melding(err), opgehaaldOp }, assets: [] };
  }
}

/**
 * Verwerkt opgehaalde resultaten in (een vers gelezen) project: oude info en oude beelden
 * van dezelfde link worden vervangen. Links die inmiddels uit het project zijn gehaald
 * worden overgeslagen.
 */
export function verwerkResultaten(p: Project, resultaten: Resultaat[]) {
  const huidig = new Set(p.links);
  const bruikbaar = resultaten.filter((r) => huidig.has(r.info.url));
  if (!bruikbaar.length) return;
  const vervangen = new Set(bruikbaar.map((r) => r.info.url));
  zetLinkInfo(p, [...linkInfoVan(p).filter((l) => !vervangen.has(l.url)), ...bruikbaar.map((r) => r.info)]);
  p.assets = [...p.assets.filter((a) => !a.bron || !vervangen.has(a.bron)), ...bruikbaar.flatMap((r) => r.assets)];
}
