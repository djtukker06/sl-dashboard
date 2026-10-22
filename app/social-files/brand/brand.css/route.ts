import { requireUser, route } from "@/lib/social/http";
import { getBrand } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// De huisstijl-CSS die elke slide laadt via ../../../brand/brand.css. Komt uit de
// database en wordt nooit gecachet, zodat een wijziging in Instellingen direct geldt.
// De logo-PNG's ernaast komen uit app/social-files/brand/[file] (ook achter de login).
export const GET = route(async () => {
  await requireUser();
  const { css } = await getBrand();
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
  });
});
