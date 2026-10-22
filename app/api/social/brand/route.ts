import { NextResponse } from "next/server";
import { readBody, requireUser, route } from "@/lib/social/http";
import { getBrand, setBrand } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// server.js:116-121
export const GET = route(async () => {
  await requireUser();
  const { css, guide } = await getBrand();
  return NextResponse.json({ css, guide });
});

// server.js:123-127: alleen velden die als string meekomen worden overschreven.
export const PUT = route(async (request: Request) => {
  await requireUser();
  const body = await readBody(request);
  const update: { css?: string; guide?: string } = {};
  if (typeof body.css === "string") update.css = body.css;
  if (typeof body.guide === "string") update.guide = body.guide;
  if (update.css !== undefined || update.guide !== undefined) await setBrand(update);
  return NextResponse.json({ ok: true });
});
