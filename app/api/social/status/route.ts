import { NextResponse } from "next/server";
import { hasApiKey } from "@/lib/social/claude";
import { FORMATS } from "@/lib/social/formats";
import { requireUser, route } from "@/lib/social/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// server.js:101-103. Op Vercel is er altijd een Chrome (@sparticuz/chromium).
export const GET = route(async () => {
  await requireUser();
  return NextResponse.json({ hasKey: hasApiKey(), chrome: true, formats: FORMATS });
});
