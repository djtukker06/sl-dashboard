import { contentDisposition, driveRoute } from '@/lib/drive/api';
import { verbind } from '@/lib/drive/koppeling';
import { MAP_MIME, DriveFout, MELDING } from '@/lib/drive/kern';
import { binnen } from '@/lib/drive/mappen';
import { isGoogleDocument, veiligInline } from '@/lib/drive/weergave';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/drive/bestanden/[id]/inhoud[?download=1]
// Geauthenticeerde proxy: teamleden zonder eigen Google-toegang bekijken/downloaden een
// bestand uit "Studio Levant" via de server (gestreamd, met Range-ondersteuning).
// Inline alleen voor afbeeldingen en PDF; al het andere (ook SVG/HTML) als download, met
// nosniff (en behalve bij PDF een sandbox-CSP), zodat een geüpload bestand nooit script op ons domein draait.
// Google Docs/Sheets/Slides worden als PDF geëxporteerd.
export const GET = driveRoute(async (request, ctx: Ctx, lid) => {
  const { id } = await ctx.params;
  const download = new URL(request.url).searchParams.get('download') === '1';
  const v = await verbind(lid.bewijs);
  const b = await binnen(v, id);
  if (b.mimeType === MAP_MIME) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);

  const google = isGoogleDocument(b.mimeType);
  const res = google ? await v.client.exportPdf(b.id) : await v.client.inhoud(b.id, request.headers.get('range'));
  const mime = google ? 'application/pdf' : b.mimeType || 'application/octet-stream';
  const naam = google && !/\.pdf$/i.test(b.name) ? `${b.name}.pdf` : b.name;

  const headers = new Headers({
    'Content-Type': veiligInline(mime) ? mime : 'application/octet-stream',
    'Content-Disposition': contentDisposition(naam, !download && veiligInline(mime) ? 'inline' : 'attachment'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  // Geen sandbox voor PDF: daarmee weigert de PDF-viewer van Chrome het bestand.
  if (mime !== 'application/pdf') headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  for (const k of ['content-length', 'content-range', 'accept-ranges']) {
    const w = res.headers.get(k);
    if (w) headers.set(k, w);
  }
  return new Response(res.body, { status: res.status === 206 ? 206 : 200, headers });
});
