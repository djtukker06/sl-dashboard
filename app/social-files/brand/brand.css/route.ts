import { requireUser, route } from "@/lib/social/http";
import { getBrand } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// De huisstijl-CSS die elke slide laadt via ../../../brand/brand.css. Komt uit de
// database. Kort privé gecachet (60 s): elke thumbnail laadt dit bestand, en zo hoeft
// dat niet per frame opnieuw langs Supabase. Na "Huisstijl opslaan" herlaadt de
// frontend de frames toch al (reloadAllFrames); hooguit een minuut oud dus.
// De logo-PNG's ernaast komen uit app/social-files/brand/[file] (ook achter de login).
export const GET = route(async () => {
  await requireUser();
  const { css } = await getBrand();
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "private, max-age=60" },
  });
});
