import { NextResponse } from "next/server";
import { hasApiKey } from "@/lib/social/claude";
import { FORMATS } from "@/lib/social/formats";
import { BUCKET, db, requireUser, route } from "@/lib/social/http";
import { getBrand } from "@/lib/social/repo";
import { logFout } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// server.js:101-103. Op Vercel is er altijd een Chrome (@sparticuz/chromium).
// dashboard: `setup` vertelt de frontend of de migraties (0014–0017) al zijn uitgevoerd,
// zodat die een setupmelding kan tonen in plaats van een lege projectlijst.
export const GET = route(async () => {
  await requireUser();
  const client = db();
  const [tables, brand, bucket] = await Promise.all([
    client
      .from("social_projects")
      .select("id", { head: true, count: "exact" })
      .then(({ error }) => {
        if (error) logFout("[social] status", error);
        return !error;
      }),
    getBrand().then(
      () => true,
      () => false,
    ),
    client.storage.getBucket(BUCKET).then(({ error }) => !error),
  ]);
  return NextResponse.json({
    hasKey: hasApiKey(),
    chrome: true,
    formats: FORMATS,
    setup: { tables, brand, bucket },
  });
});
