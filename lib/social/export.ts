// Export-hulpfuncties (server.js:393-441): alle slides van een project renderen in
// één browser, en het bronpakket (vervanger van "toon map in Finder") samenstellen.

import { getFormat } from "./formats";
import { openRenderer } from "./render";
import { dbRenderSource, readBrandPng } from "./source";
import { BRAND_PNGS } from "./render";
import { downloadAsset, getBrand, listAssetObjects, readAllSlideRows, readSlides, type Project } from "./repo";
import type { ZipEntry } from "./zip";

/** server.js `renderAll()`: PNG per actieve slide, in volgorde. */
export async function renderAll(p: Project): Promise<Buffer[]> {
  const fmt = getFormat(p.format);
  const slides = await readSlides(p);
  const renderer = await openRenderer(p.id, dbRenderSource(p.id, new Map(slides.map((s) => [s.file, s.html]))));
  try {
    const out: Buffer[] = [];
    for (const s of slides) out.push(await renderer.renderPng(s.file, fmt.w, fmt.h));
    return out;
  } finally {
    await renderer.close();
  }
}

/** server.js:432-441: PDF met een pagina per slide. */
export async function renderPdf(p: Project): Promise<Buffer> {
  const fmt = getFormat(p.format);
  const slides = await readSlides(p);
  const renderer = await openRenderer(p.id, dbRenderSource(p.id, new Map(slides.map((s) => [s.file, s.html]))));
  try {
    const pngs: Buffer[] = [];
    for (const s of slides) pngs.push(await renderer.renderPng(s.file, fmt.w, fmt.h));
    return await renderer.pngsToPdf(pngs, fmt.w, fmt.h);
  } finally {
    await renderer.close();
  }
}

/**
 * Inhoud van de oude projectmap als ZIP, met dezelfde mappenstructuur zodat de
 * slides lokaal in een browser openen met werkende relatieve paden:
 *   brand/brand.css, brand/*.png
 *   projects/<id>/project.json, projects/<id>/slides/*.html, projects/<id>/assets/*
 */
export async function sourceEntries(p: Project): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const brand = await getBrand();
  entries.push({ name: "brand/brand.css", data: brand.css });
  for (const name of BRAND_PNGS) {
    const png = await readBrandPng(name);
    if (png) entries.push({ name: `brand/${name}`, data: png });
  }
  const base = `projects/${p.id}`;
  entries.push({ name: `${base}/project.json`, data: JSON.stringify(p, null, 2) });
  for (const s of await readAllSlideRows(p.id)) entries.push({ name: `${base}/slides/${s.file}`, data: s.html });
  for (const o of await listAssetObjects(p.id)) {
    const bytes = await downloadAsset(p.id, o.name);
    if (bytes) entries.push({ name: `${base}/assets/${o.name}`, data: bytes });
  }
  return entries;
}
