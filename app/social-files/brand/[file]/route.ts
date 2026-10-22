import { httpError, requireUser, route } from "@/lib/social/http";
import { readBrandPng } from "@/lib/social/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

// De logo's en banners van de huisstijl (assets/social-brand/). Ze staan bewust niet in
// public/: paden op .png vallen buiten de matcher van proxy.ts, dus deze route checkt zelf
// de sessie. Alleen namen uit BRAND_PNGS zijn toegestaan (readBrandPng controleert dat).
export const GET = route(async (_request: Request, { params }: Ctx) => {
  await requireUser();
  const { file } = await params;
  const png = await readBrandPng(file);
  if (!png) throw httpError(404, "Bestand niet gevonden");
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
