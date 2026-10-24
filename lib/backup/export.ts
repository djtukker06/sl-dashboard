import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { BUCKETS, NIET_EXPORTEREN, TABELLEN, rijenHash, type DbExport, type DbTabelExport } from './formaat-kern';
import { lijstBucket } from './storage';

// Volledige export van de eigen tabellen via de service-role (REST, geen databasewachtwoord
// nodig), plus de gebruikers (zonder wachtwoord-hashes) en een overzicht van de storage-
// bestanden. Alles in het geheugen; bij de huidige omvang (een paar MB) ruim genoeg.

const PER_PAGINA = 1000;
const MAX_RIJEN = 500_000;

async function exporteerTabel(sb: SupabaseClient, naam: string, pk: string[]): Promise<DbTabelExport | null> {
  const rijen: Record<string, unknown>[] = [];
  for (let van = 0; van < MAX_RIJEN; van += PER_PAGINA) {
    let q = sb.from(naam).select('*');
    for (const k of pk) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(van, van + PER_PAGINA - 1);
    if (error) {
      if (tabelOntbreekt(error)) return null;
      throw error;
    }
    const pagina = (data ?? []) as Record<string, unknown>[];
    rijen.push(...pagina);
    if (pagina.length < PER_PAGINA) break;
  }
  return { pk, rijen, aantal: rijen.length, sha256: rijenHash(rijen) };
}

export interface ExportResultaat {
  export: DbExport;
  tellingen: Record<string, number>;
  waarschuwingen: string[];
}

export async function maakDbExport(sb: SupabaseClient, nu: Date = new Date()): Promise<ExportResultaat> {
  const tabellen: Record<string, DbTabelExport> = {};
  const ontbrekend: string[] = [];
  const waarschuwingen: string[] = [];

  for (const def of TABELLEN) {
    const t = await exporteerTabel(sb, def.naam, def.pk);
    if (t) tabellen[def.naam] = t;
    else ontbrekend.push(def.naam);
  }

  // Tabellen die later zijn bijgekomen en niet in de vaste lijst staan: toch meenemen.
  const { data: alle, error: alleFout } = await sb.rpc('backup_tabellen');
  if (!alleFout && Array.isArray(alle)) {
    const bekend = new Set(TABELLEN.map((t) => t.naam));
    for (const r of alle as unknown[]) {
      const naam = typeof r === 'string' ? r : String((r as Record<string, unknown>)?.backup_tabellen ?? '');
      if (!/^[a-z0-9_]{1,63}$/.test(naam) || bekend.has(naam) || NIET_EXPORTEREN.has(naam)) continue;
      const t = await exporteerTabel(sb, naam, []);
      if (t) {
        tabellen[naam] = t;
        waarschuwingen.push(`tabel ${naam} staat niet in de vaste lijst (wel meegenomen)`);
      }
    }
  }

  const gebruikers: DbExport['gebruikers'] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const u of users) {
      gebruikers.push({ id: u.id, email: u.email ?? null, created_at: u.created_at ?? null, email_confirmed_at: u.email_confirmed_at ?? null });
    }
    if (users.length < 200) break;
  }

  const storage: DbExport['storage'] = {};
  for (const bucket of BUCKETS) storage[bucket] = await lijstBucket(sb, bucket);

  const tellingen: Record<string, number> = {};
  for (const [naam, t] of Object.entries(tabellen)) tellingen[naam] = t.aantal;

  return {
    export: {
      formaat: 'sl-db-export',
      versie: 1,
      gemaakt: nu.toISOString(),
      migratie: '0026',
      tabellen,
      ontbrekend,
      gebruikers,
      storage
    },
    tellingen,
    waarschuwingen
  };
}
