// RenderSource voor productie: slides en brand.css uit de database, logo's uit de
// meegebundelde public/social-files/brand/*.png, beeldmateriaal uit Storage.

import fs from "node:fs/promises";
import path from "node:path";
import { BRAND_PNGS, type RenderSource } from "./render";
import { downloadAsset, getBrand, readSlideRow } from "./repo";

const BRAND_DIR = path.join(process.cwd(), "public", "social-files", "brand");

export async function readBrandPng(name: string): Promise<Buffer | null> {
  if (!BRAND_PNGS.includes(name)) return null;
  return fs.readFile(path.join(BRAND_DIR, name)).catch(() => null);
}

export function dbRenderSource(projectId: string, slides?: Map<string, string>): RenderSource {
  let css: Promise<string | null> | null = null;
  return {
    slide: async (file) => slides?.get(file) ?? (await readSlideRow(projectId, file)),
    brandCss: () => (css ??= getBrand().then((b) => b.css, () => null)),
    brandPng: readBrandPng,
    asset: (file) => downloadAsset(projectId, file),
  };
}
