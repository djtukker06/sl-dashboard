// Port van Social-media-tool/lib/render.js voor Vercel.
//
// - Lokaal (NODE_ENV !== 'production'): puppeteer-core met een lokaal geïnstalleerde
//   Chrome (zoals de oude tool), of anders het `puppeteer`-devpakket met eigen Chrome.
// - Productie: puppeteer-core + @sparticuz/chromium, exact zoals lib/invoice/pdf.ts.
// - Eén browser per request, altijd gesloten in `finally` (via openRenderer().close()).
//
// Slides worden geladen zonder cookies of localhost: de pagina draait op een nep-origin
// (https://render.social.local) en een request-interceptor bedient alle bestanden uit
// een `RenderSource` (database/Storage in productie, in-memory in de rooktest). Zo blijven
// de relatieve paden in de slide-HTML (../../../brand/..., ../assets/...) byte-identiek.

import fs from "node:fs";
import type { Browser, HTTPRequest, Page } from "puppeteer-core";

export const RENDER_ORIGIN = "https://render.social.local";

export const BRAND_PNGS = [
  "logo-licht.png",
  "logo-donker.png",
  "logo-compact-licht.png",
  "logo-compact-donker.png",
  "banner-licht.png",
  "banner-donker.png",
];

/** Waar de renderer zijn bestanden vandaan haalt. null = bestaat niet (404). */
export type RenderSource = {
  slide(file: string): Promise<string | null>;
  brandCss(): Promise<string | null>;
  brandPng(name: string): Promise<Buffer | null>;
  asset(file: string): Promise<Buffer | null>;
};

const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV !== "production") {
    const local = LOCAL_CHROME.find((p) => fs.existsSync(p));
    if (local) {
      const puppeteerCore = await import("puppeteer-core");
      return puppeteerCore.launch({ executablePath: local, headless: true, args: ["--hide-scrollbars"] });
    }
    const puppeteer = await import("puppeteer");
    return puppeteer.launch({ headless: true, args: ["--hide-scrollbars"] }) as unknown as Promise<Browser>;
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteerCore = await import("puppeteer-core");
  return puppeteerCore.launch({
    args: [...chromium.args, "--hide-scrollbars"],
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

function contentTypeFor(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

const SAFE = /^[a-z0-9][a-z0-9._-]*$/i;

function isPublicHttps(url: URL) {
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false; // IPv6/IPv4-literals
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  return host.includes(".");
}

async function serve(req: HTTPRequest, projectId: string, source: RenderSource) {
  const raw = req.url();
  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw === "about:blank") return req.continue();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return req.abort();
  }

  // Google Fonts mag gewoon door (brand.css laadt Manrope en Fragment Mono).
  if (url.protocol === "https:" && (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com")) {
    return req.continue();
  }
  // Externe afbeeldingen (<img src="https://…">, CSS background-url) in handmatig bewerkte
  // slides laden ook in de preview-iframe; laat ze dus ook in de export mee laden. Alleen
  // https en een gewone hostnaam, geen IP-adressen of localhost (geen toegang tot interne
  // adressen vanaf de server).
  if (url.origin !== RENDER_ORIGIN && req.resourceType() === "image" && isPublicHttps(url)) {
    return req.continue();
  }
  if (url.origin !== RENDER_ORIGIN) return req.abort();

  const notFound = () => req.respond({ status: 404, contentType: "text/plain", body: "Niet gevonden" });
  const parts = url.pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });

  // /brand/brand.css en /brand/<logo>.png
  if (parts.length === 2 && parts[0] === "brand") {
    if (parts[1] === "brand.css") {
      const css = await source.brandCss();
      return css === null ? notFound() : req.respond({ status: 200, contentType: "text/css; charset=utf-8", body: css });
    }
    if (BRAND_PNGS.includes(parts[1])) {
      const png = await source.brandPng(parts[1]);
      return png ? req.respond({ status: 200, contentType: "image/png", body: png }) : notFound();
    }
    return notFound();
  }

  // /projects/<id>/slides/<bestand> en /projects/<id>/assets/<bestand>
  if (parts.length === 4 && parts[0] === "projects" && parts[1] === projectId && SAFE.test(parts[3])) {
    if (parts[2] === "slides") {
      const html = await source.slide(parts[3]);
      return html === null
        ? notFound()
        : req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    if (parts[2] === "assets") {
      const bytes = await source.asset(parts[3]);
      return bytes ? req.respond({ status: 200, contentType: contentTypeFor(parts[3]), body: bytes }) : notFound();
    }
  }
  return notFound();
}

export type Renderer = {
  renderPng(file: string, w: number, h: number, scale?: number): Promise<Buffer>;
  pngsToPdf(pngs: Buffer[], w: number, h: number): Promise<Buffer>;
  close(): Promise<void>;
};

/** Start één browser voor dit request. Altijd `close()` aanroepen in een `finally`. */
export async function openRenderer(projectId: string, source: RenderSource): Promise<Renderer> {
  const browser = await launchBrowser();

  async function newPage(intercept: boolean): Promise<Page> {
    const page = await browser.newPage();
    if (intercept) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        serve(req, projectId, source).catch(() => {
          // Een fout bij één bestand mag de render niet laten falen: behandelen als 404.
          if (!req.isInterceptResolutionHandled()) {
            req.respond({ status: 404, contentType: "text/plain", body: "Niet gevonden" }).catch(() => {});
          }
        });
      });
    }
    return page;
  }

  return {
    /** Rendert een slide naar een PNG-buffer op het exacte canvasformaat (render.js:41-59). */
    async renderPng(file, w, h, scale = 1) {
      const page = await newPage(true);
      try {
        await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
        await page.goto(`${RENDER_ORIGIN}/projects/${encodeURIComponent(projectId)}/slides/${encodeURIComponent(file)}`, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((img) =>
              img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)),
            ),
          );
        });
        return Buffer.from(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } }));
      } finally {
        await page.close();
      }
    },

    /** Zet een reeks PNG's om naar één PDF, een pagina per slide (render.js:62-77). */
    async pngsToPdf(pngs, w, h) {
      const page = await newPage(false);
      try {
        const imgs = pngs.map((b) => `<img src="data:image/png;base64,${b.toString("base64")}">`).join("");
        await page.setContent(
          `<!doctype html><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0}img{display:block;width:${w}px;height:${h}px;page-break-after:always}img:last-child{page-break-after:auto}</style>${imgs}`,
          { waitUntil: "load" },
        );
        return Buffer.from(await page.pdf({ width: `${w}px`, height: `${h}px`, printBackground: true }));
      } finally {
        await page.close();
      }
    },

    async close() {
      await browser.close();
    },
  };
}
