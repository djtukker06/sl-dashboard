import { NextResponse } from 'next/server';
import { eigenaarRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { verbindMetService } from '@/lib/drive/koppeling';
import { DriveFout } from '@/lib/drive/kern';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const MAX_STREAM = 4 * 1024 * 1024;

// Eigenaar (met 2FA-sessie): een database-back-up downloaden, VERSLEUTELD (.slbak). Alleen
// met BACKUP_ENCRYPTION_KEY en scripts/backup-herstellen.mjs is hij te lezen. Kleiner dan
// 4 MB: rechtstreeks; groter: door naar het bestand in Google Drive (de limiet van Vercel).
export const GET = eigenaarRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende back-up.' }, { status: 404, headers: GEEN_CACHE });
  const service = createServiceRoleClient(lid.bewijs);
  const { data, error } = await service.from('backup_runs').select('bestand, drive_id, status, soort').eq('id', id).maybeSingle();
  if (error) throw error;
  const run = data as { bestand: string | null; drive_id: string | null; status: string; soort: string } | null;
  if (!run || run.soort !== 'db' || run.status !== 'ok' || !run.drive_id || !run.bestand) {
    return NextResponse.json({ error: 'Onbekende back-up.' }, { status: 404, headers: GEEN_CACHE });
  }
  try {
    const v = await verbindMetService(service);
    const b = await v.client.bestand(run.drive_id, 'id,name,size,webViewLink,trashed');
    if (b.trashed) return NextResponse.json({ error: 'Deze back-up is al opgeruimd.' }, { status: 404, headers: GEEN_CACHE });
    await logAudit('backup_gedownload', { userId: lid.userId, doel: run.bestand }, request);
    const grootte = Number(b.size ?? 0);
    if (grootte > MAX_STREAM) {
      const link = b.webViewLink ?? '';
      if (!/^https:\/\/drive\.google\.com\//.test(link)) return NextResponse.json({ error: 'Open de back-up in Google Drive.' }, { status: 409, headers: GEEN_CACHE });
      return NextResponse.redirect(link, { status: 303, headers: GEEN_CACHE });
    }
    const res = await v.client.inhoud(run.drive_id);
    const naam = run.bestand.replace(/[^A-Za-z0-9._-]/g, '_');
    return new Response(res.body, {
      headers: {
        ...GEEN_CACHE,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${naam}"`,
        'X-Content-Type-Options': 'nosniff',
        ...(grootte ? { 'Content-Length': String(grootte) } : {})
      }
    });
  } catch (e) {
    if (e instanceof DriveFout) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers: GEEN_CACHE });
    throw e;
  }
}, { label: 'backup' });
