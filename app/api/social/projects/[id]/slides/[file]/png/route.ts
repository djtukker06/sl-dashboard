import { NextResponse } from "next/server";
import { attachment, checkFile, redirectToSigned, requireUser, route } from "@/lib/social/http";
import { getFormat } from "@/lib/social/formats";
import { slug } from "@/lib/social/ids";
import { openRenderer } from "@/lib/social/render";
import { checkSlide, getProject } from "@/lib/social/repo";
import { dbRenderSource } from "@/lib/social/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; file: string }> };

const DIRECT_LIMIT = 4 * 1024 * 1024;

// server.js:405-415: PNG van één slide. Onder 4 MB direct, anders via Storage-redirect.
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { id, file } = await params;
  checkFile(file);
  const p = await getProject(id);
  checkSlide(p, file);
  const fmt = getFormat(p.format);
  const renderer = await openRenderer(p.id, dbRenderSource(p.id));
  let png: Buffer;
  try {
    png = await renderer.renderPng(file, fmt.w, fmt.h);
  } finally {
    await renderer.close();
  }
  const n = String(p.slides.indexOf(file) + 1).padStart(2, "0");
  const name = `${slug(p.name)}-${n}.png`;
  if (png.length >= DIRECT_LIMIT) return redirectToSigned(p.id, name, png, "image/png");
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Content-Disposition": attachment(name), "Cache-Control": "no-store" },
  });
});
