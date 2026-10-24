import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { DriveFout } from '@/lib/drive/kern';
import { verbindMetService } from '@/lib/drive/koppeling';
import { logAudit, type AuditBron } from '@/lib/audit';
import { foutSamenvatting, logFout, logWaarschuwing } from '@/lib/log';
import { backupSleutel } from './config';
import { BUCKETS, backupNaam, bestandNaamInDrive, bronVan, exportNaarBytes, sha256Hex, sleutelIdVan, versleutel } from './formaat-kern';
import { maakDbExport } from './export';
import { bestandenMap, ruimOudeBackupsOp, uploadBestand, uploadDbBackup } from './drive';
import { lijstBucket } from './storage';

// De back-uptaken. Allemaal met een service-role client die de aanroeper al heeft
// gecontroleerd (cron: CRON_SECRET; knop: eigenaar met 2FA-sessie).
//
//   heartbeat()              keep-alive: een kleine schrijfactie (werkt ook vóór 0026)
//   opruimen()               heartbeat (laatste 120), inlogpogingen (> 1 dag), audit (> 400 dagen)
//   maakDbBackup()           database-export → versleuteld → Drive → bewaarbeleid
//   synchroniseerBestanden() storage-bestanden incrementeel en versleuteld naar Drive

export type RunBron = 'cron' | 'github' | 'handmatig' | 'script';
const HB_BEWAREN = 120;
const DB_MIN_INTERVAL_UUR = 20;
const BESTANDEN_INTERVAL_DAGEN = 6;
const MAX_BESTAND = 50 * 1024 * 1024;

function auditBron(bron: RunBron): AuditBron {
  return bron === 'handmatig' ? 'app' : bron === 'script' ? 'script' : bron;
}

/** Een korte foutmelding voor backup_runs: begrijpelijk, zonder data of tokens. */
function runFout(e: unknown): string {
  if (e instanceof DriveFout) return `Google Drive: ${e.message}`.slice(0, 500);
  return foutSamenvatting(e).slice(0, 500);
}

// ---------------------------------------------------------------------------------
// Keep-alive
// ---------------------------------------------------------------------------------
export async function heartbeat(service: SupabaseClient, bron: RunBron): Promise<'ok' | 'zonder_tabel'> {
  const { error } = await service.from('heartbeat').insert({ bron });
  if (!error) return 'ok';
  if (!tabelOntbreekt(error)) throw error;
  // Vóór migratie 0026: een kleine leesquery is ook activiteit.
  const r = await service.from('team_members').select('user_id').limit(1);
  if (r.error) throw r.error;
  return 'zonder_tabel';
}

export async function opruimen(service: SupabaseClient): Promise<void> {
  try {
    const { data } = await service.from('heartbeat').select('id').order('op', { ascending: false }).order('id', { ascending: false }).range(HB_BEWAREN - 1, HB_BEWAREN - 1);
    const grens = (data as { id: number }[] | null)?.[0]?.id;
    if (grens) await service.from('heartbeat').delete().lt('id', grens);
  } catch (e) {
    logWaarschuwing('[backup] heartbeat opruimen', e);
  }
  try {
    await service.from('inlog_pogingen').delete().lt('op', new Date(Date.now() - 86_400_000).toISOString());
  } catch (e) {
    logWaarschuwing('[backup] inlogpogingen opruimen', e);
  }
  try {
    const { error } = await service.rpc('audit_opruimen', { p_dagen: 400 });
    if (error && !tabelOntbreekt(error)) logWaarschuwing('[backup] audit opruimen', error);
  } catch (e) {
    logWaarschuwing('[backup] audit opruimen', e);
  }
}

// ---------------------------------------------------------------------------------
// Database-back-up
// ---------------------------------------------------------------------------------
export interface DbBackupUitkomst {
  status: 'ok' | 'mislukt' | 'overgeslagen' | 'migratie_ontbreekt';
  id?: string;
  bestand?: string;
  grootte?: number;
  fout?: string;
  reden?: string;
}

interface RunRij {
  id: string;
  status: string;
  gestart: string;
  klaar: string | null;
  tellingen: Record<string, unknown> | null;
}

async function laatsteRun(service: SupabaseClient, soort: 'db' | 'bestanden', status?: string): Promise<RunRij | null | 'ontbreekt'> {
  let q = service.from('backup_runs').select('id, status, gestart, klaar, tellingen').eq('soort', soort);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('gestart', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return 'ontbreekt';
    throw error;
  }
  return (data as RunRij | null) ?? null;
}

/** Is er een nieuwe database-back-up nodig (laatste geslaagde ouder dan 20 uur)? */
export async function dbBackupNodig(service: SupabaseClient, nu: number = Date.now()): Promise<boolean | 'migratie_ontbreekt'> {
  const r = await laatsteRun(service, 'db', 'ok');
  if (r === 'ontbreekt') return 'migratie_ontbreekt';
  return !r || nu - new Date(r.gestart).getTime() > DB_MIN_INTERVAL_UUR * 3_600_000;
}

export async function maakDbBackup(service: SupabaseClient, o: { bron: RunBron; door?: string | null }): Promise<DbBackupUitkomst> {
  const nu = new Date();
  // Loopt er al een (minder dan 15 minuten geleden gestart)? Dan niet nog een.
  const lopend = await laatsteRun(service, 'db', 'bezig');
  if (lopend === 'ontbreekt') return { status: 'migratie_ontbreekt' };
  if (lopend) {
    if (nu.getTime() - new Date(lopend.gestart).getTime() < 15 * 60_000) return { status: 'overgeslagen', reden: 'er loopt al een back-up' };
    await service.from('backup_runs').update({ status: 'mislukt', klaar: nu.toISOString(), fout: 'Afgebroken (time-out).' }).eq('id', lopend.id);
  }

  const sleutel = backupSleutel();
  const { data: rij, error: insFout } = await service
    .from('backup_runs')
    .insert({ soort: 'db', bron: o.bron, door: o.door ?? null, status: sleutel ? 'bezig' : 'mislukt', klaar: sleutel ? null : nu.toISOString(), fout: sleutel ? null : 'BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig: er is niets (onversleuteld) weggeschreven.' })
    .select('id')
    .single();
  if (insFout) {
    if (tabelOntbreekt(insFout)) return { status: 'migratie_ontbreekt' };
    throw insFout;
  }
  const id = (rij as { id: string }).id;
  if (!sleutel) {
    await logAudit('backup_mislukt', { userId: o.door ?? null, bron: auditBron(o.bron), details: { soort: 'db', reden: 'sleutel ontbreekt' } });
    return { status: 'mislukt', id, fout: 'BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig.' };
  }

  try {
    const { export: exp, tellingen, waarschuwingen } = await maakDbExport(service, nu);
    const bytes = exportNaarBytes(exp);
    if (bytes.length > 200 * 1024 * 1024) waarschuwingen.push('export groter dan 200 MB');
    const { bestand, header } = versleutel(sleutel, bytes, { soort: 'db', bron: bronVan(process.env.NEXT_PUBLIC_SUPABASE_URL), gemaakt: nu });
    const v = await verbindMetService(service);
    const naam = backupNaam(nu, o.bron === 'handmatig');
    const b = await uploadDbBackup(v, naam, bestand);
    const storage = Object.fromEntries(Object.entries(exp.storage).map(([k, l]) => [k, l.length]));
    await service
      .from('backup_runs')
      .update({
        status: 'ok',
        klaar: new Date().toISOString(),
        bestand: naam,
        drive_id: b.id,
        grootte: bestand.length,
        sha256: sha256Hex(bestand),
        sleutel_id: header.sleutelId,
        tellingen: {
          tabellen: tellingen,
          gebruikers: exp.gebruikers.length,
          storage,
          ontbrekend: exp.ontbrekend ?? [],
          waarschuwingen: waarschuwingen.slice(0, 10)
        }
      })
      .eq('id', id);
    // Bewaarbeleid pas na een geslaagde upload; een fout hierbij maakt de back-up niet ongeldig.
    let opgeruimd = 0;
    try {
      opgeruimd = await ruimOudeBackupsOp(v);
    } catch (e) {
      logWaarschuwing('[backup] oude back-ups opruimen', e);
    }
    await logAudit('backup_gemaakt', {
      userId: o.door ?? null,
      bron: auditBron(o.bron),
      doel: naam,
      details: { soort: 'db', aantal: Object.values(tellingen).reduce((a, n) => a + n, 0), status: opgeruimd ? `${opgeruimd} oude opgeruimd` : 'ok' }
    });
    return { status: 'ok', id, bestand: naam, grootte: bestand.length };
  } catch (e) {
    const fout = runFout(e);
    logFout('[backup] database-back-up mislukt', e);
    await service.from('backup_runs').update({ status: 'mislukt', klaar: new Date().toISOString(), fout }).eq('id', id);
    await logAudit('backup_mislukt', { userId: o.door ?? null, bron: auditBron(o.bron), details: { soort: 'db', reden: fout.slice(0, 150) } });
    return { status: 'mislukt', id, fout };
  }
}

// ---------------------------------------------------------------------------------
// Storage-bestanden (incrementeel)
// ---------------------------------------------------------------------------------
export interface BestandenUitkomst {
  status: 'ok' | 'bezig' | 'mislukt' | 'overgeslagen' | 'migratie_ontbreekt';
  id?: string;
  gesynchroniseerd?: number;
  resterend?: number;
  fout?: string;
  reden?: string;
}

interface BestandRij {
  bucket: string;
  pad: string;
  etag: string | null;
  bijgewerkt: string | null;
  drive_id: string | null;
  verwijderd_op: string | null;
}

async function bekendeBestanden(service: SupabaseClient, bucket: string): Promise<Map<string, BestandRij>> {
  const uit = new Map<string, BestandRij>();
  for (let van = 0; van < 100_000; van += 1000) {
    const { data, error } = await service
      .from('backup_bestanden')
      .select('bucket, pad, etag, bijgewerkt, drive_id, verwijderd_op')
      .eq('bucket', bucket)
      .order('pad')
      .range(van, van + 999);
    if (error) throw error;
    for (const r of (data ?? []) as BestandRij[]) uit.set(r.pad, r);
    if ((data ?? []).length < 1000) break;
  }
  return uit;
}

function zelfdeTijd(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * Eén ronde (of het vervolg ervan) binnen `budgetMs`. Een nieuwe ronde start als de vorige
 * geslaagde ouder is dan 6 dagen (of `forceer`); een onafgemaakte ronde gaat gewoon verder.
 * Alleen nieuwe of gewijzigde bestanden gaan (opnieuw) naar Drive; wat uit storage is
 * verdwenen blijft in Drive staan (alleen gemarkeerd).
 */
export async function synchroniseerBestanden(
  service: SupabaseClient,
  o: { bron: RunBron; door?: string | null; budgetMs?: number; forceer?: boolean }
): Promise<BestandenUitkomst> {
  const start = Date.now();
  const deadline = start + (o.budgetMs ?? 240_000);
  const laatste = await laatsteRun(service, 'bestanden');
  if (laatste === 'ontbreekt') return { status: 'migratie_ontbreekt' };

  let run: RunRij;
  if (laatste && laatste.status === 'bezig') {
    run = laatste;
  } else {
    if (!o.forceer && laatste && laatste.status === 'ok' && start - new Date(laatste.gestart).getTime() < BESTANDEN_INTERVAL_DAGEN * 86_400_000) {
      return { status: 'overgeslagen', reden: 'laatste ronde is nog geen 6 dagen oud' };
    }
    const sleutel0 = backupSleutel();
    const { data, error } = await service
      .from('backup_runs')
      .insert({ soort: 'bestanden', bron: o.bron, door: o.door ?? null, status: sleutel0 ? 'bezig' : 'mislukt', klaar: sleutel0 ? null : new Date().toISOString(), fout: sleutel0 ? null : 'BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig.' })
      .select('id, status, gestart, klaar, tellingen')
      .single();
    if (error) {
      if (tabelOntbreekt(error)) return { status: 'migratie_ontbreekt' };
      throw error;
    }
    run = data as RunRij;
    if (!sleutel0) return { status: 'mislukt', id: run.id, fout: 'BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig.' };
  }

  const sleutel = backupSleutel();
  const vorige = (run.tellingen ?? {}) as Record<string, number>;
  const telling = { gesynchroniseerd: Number(vorige.gesynchroniseerd) || 0, te_groot: Number(vorige.te_groot) || 0, verwijderd: Number(vorige.verwijderd) || 0, totaal: 0, resterend: 0 };
  try {
    if (!sleutel) throw new Error('BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig.');
    const v = await verbindMetService(service);
    const bron = bronVan(process.env.NEXT_PUBLIC_SUPABASE_URL);
    let tijdOp = false;

    for (const bucket of BUCKETS) {
      const items = await lijstBucket(service, bucket);
      const bekend = await bekendeBestanden(service, bucket);
      telling.totaal += items.length;

      // Uit storage verdwenen: alleen markeren (de kopie in Drive blijft staan).
      const nuAanwezig = new Set(items.map((i) => i.pad));
      const weg = [...bekend.values()].filter((r) => !nuAanwezig.has(r.pad) && !r.verwijderd_op).map((r) => r.pad);
      for (let i = 0; i < weg.length; i += 100) {
        await service.from('backup_bestanden').update({ verwijderd_op: new Date().toISOString() }).eq('bucket', bucket).in('pad', weg.slice(i, i + 100));
      }
      telling.verwijderd += weg.length;

      const teDoen = items.filter((it) => {
        const r = bekend.get(it.pad);
        return !r || !r.drive_id || r.verwijderd_op || (r.etag ?? null) !== (it.etag ?? null) || !zelfdeTijd(r.bijgewerkt, it.bijgewerkt);
      });
      if (!teDoen.length) continue;
      const ouder = await bestandenMap(v, bucket);

      for (let i = 0; i < teDoen.length; i++) {
        const it = teDoen[i];
        if (Date.now() > deadline) {
          telling.resterend += teDoen.length - i;
          tijdOp = true;
          break;
        }
        if ((it.grootte ?? 0) > MAX_BESTAND) {
          telling.te_groot++;
          continue;
        }
        const { data: blob, error } = await service.storage.from(bucket).download(it.pad);
        if (error || !blob) {
          logWaarschuwing('[backup] bestand downloaden', error);
          continue;
        }
        const inhoud = new Uint8Array(await blob.arrayBuffer());
        const { bestand } = versleutel(sleutel, inhoud, { soort: 'bestand', bron, pad: `${bucket}/${it.pad}` });
        const b = await uploadBestand(v, { ouderId: ouder, naam: bestandNaamInDrive(it.pad), inhoud: bestand, driveId: bekend.get(it.pad)?.drive_id });
        const { error: upFout } = await service.from('backup_bestanden').upsert(
          {
            bucket,
            pad: it.pad,
            grootte: it.grootte,
            bijgewerkt: it.bijgewerkt,
            etag: it.etag,
            drive_id: b.id,
            gesynchroniseerd_op: new Date().toISOString(),
            verwijderd_op: null
          },
          { onConflict: 'bucket,pad' }
        );
        if (upFout) throw upFout;
        telling.gesynchroniseerd++;
      }
      if (tijdOp) {
        // De overige buckets tellen ook nog als resterend (volgende keer verder).
        break;
      }
    }

    const klaar = !tijdOp;
    await service
      .from('backup_runs')
      .update({
        status: klaar ? 'ok' : 'bezig',
        klaar: klaar ? new Date().toISOString() : null,
        tellingen: { ...telling, sleutel: sleutelIdVan(sleutel) }
      })
      .eq('id', run.id);
    if (klaar) {
      await logAudit('backup_bestanden', { userId: o.door ?? null, bron: auditBron(o.bron), details: { soort: 'bestanden', aantal: telling.gesynchroniseerd } });
    }
    return { status: klaar ? 'ok' : 'bezig', id: run.id, gesynchroniseerd: telling.gesynchroniseerd, resterend: telling.resterend };
  } catch (e) {
    const fout = runFout(e);
    logFout('[backup] bestanden-sync mislukt', e);
    await service.from('backup_runs').update({ status: 'mislukt', klaar: new Date().toISOString(), fout, tellingen: telling }).eq('id', run.id);
    await logAudit('backup_mislukt', { userId: o.door ?? null, bron: auditBron(o.bron), details: { soort: 'bestanden', reden: fout.slice(0, 150) } });
    return { status: 'mislukt', id: run.id, fout };
  }
}
