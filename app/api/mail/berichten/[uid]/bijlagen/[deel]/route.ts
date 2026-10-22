import { NextResponse } from 'next/server';
import { mailRoute } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';
import { haalBijlage } from '@/lib/mail/berichten';
import { signedDownload } from '@/lib/mail/opslag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string; deel: string }> };

const MAX_BIJLAGE = 25 * 1024 * 1024;
/** Boven dit via Supabase Storage (Vercel-responslimiet is 4,5 MB). */
const MAX_DIRECT = 4 * 1024 * 1024;

// Typen die een browser zou kunnen uitvoeren of als pagina tonen: altijd als octet-stream.
const RISICO = /(html|svg|xml|javascript|ecmascript|x-sh|x-msdownload)/i;

function contentDisposition(naam: string) {
  const ascii = naam.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(naam)}`;
}

// GET /api/mail/berichten/[uid]/bijlagen/[deel]?map=INBOX → download (altijd als bijlage)
export const GET = mailRoute(async (request: Request, ctx: Ctx) => {
  const { uid: uidRuw, deel } = await ctx.params;
  const uid = parseUid(uidRuw);
  const sp = new URL(request.url).searchParams;
  const b = await metImap(async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return haalBijlage(c, map.pad, uid, decodeURIComponent(deel), MAX_BIJLAGE);
  });

  if (b.inhoud.length > MAX_DIRECT) {
    const signed = await signedDownload(b.naam, b.inhoud);
    // De lezer downloadt via fetch (header X-SL-Download): dan de URL als JSON teruggeven,
    // zodat een cross-origin redirect niet nodig is. Een gewone link krijgt een redirect.
    if (request.headers.get('x-sl-download') === 'fetch') {
      return NextResponse.json({ url: signed }, { headers: { 'X-SL-Signed': '1', 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.redirect(signed, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const type = !b.type || RISICO.test(b.type) ? 'application/octet-stream' : b.type;
  return new Response(new Uint8Array(b.inhoud), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(b.inhoud.length),
      'Content-Disposition': contentDisposition(b.naam),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store'
    }
  });
});
