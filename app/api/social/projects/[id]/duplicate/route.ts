import { NextResponse } from "next/server";
import { BUCKET, db, requireUser, route } from "@/lib/social/http";
import { newProjectId } from "@/lib/social/ids";
import {
  assetPath,
  getProject,
  listAssetObjects,
  markeerMaker,
  readAllSlideRows,
  saveProject,
  writeSlides,
  type Project,
} from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// server.js:198-207: kopie met alle slides en beeldmateriaal, zonder versies.
export const POST = route(async (_request: Request, { params }: Ctx) => {
  const gebruiker = await requireUser();
  const { id } = await params;
  const src = await getProject(id);
  const now = new Date().toISOString();
  const p: Project = { ...src, id: newProjectId(now), name: `${src.name} (kopie)`, createdAt: now };
  delete p.versionCount;

  await saveProject(p);
  await markeerMaker(p.id, gebruiker.id);
  await writeSlides(p.id, await readAllSlideRows(src.id));
  const storage = db().storage.from(BUCKET);
  for (const o of await listAssetObjects(src.id)) {
    const { error } = await storage.copy(assetPath(src.id, o.name), assetPath(p.id, o.name));
    if (error) console.error(`Kon ${o.name} niet kopiëren:`, error);
  }
  return NextResponse.json(p);
});
