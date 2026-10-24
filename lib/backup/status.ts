import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { backupOntbreekt, huidigSleutelId } from './config';

// Status van back-ups en keep-alive, voor het blok "Back-ups" op /beveiliging en de
// waarschuwing op het dashboard (alleen de eigenaar). Gelezen met de gebruikerscliënt: RLS
// (is_eigenaar, dus ook 2FA) beslist mee. Nooit sleutels of Drive-tokens.

export interface BackupRun {
  id: string;
  soort: 'db' | 'bestanden';
  bron: string;
  gestart: string;
  klaar: string | null;
  status: 'bezig' | 'ok' | 'mislukt' | 'overgeslagen';
  bestand: string | null;
  grootte: number | null;
  sleutelId: string | null;
  tellingen: Record<string, unknown>;
  fout: string | null;
  downloadbaar: boolean;
}

export interface BackupStatus {
  migratie: boolean;
  ontbreekt: string[];
  sleutelId: string | null;
  laatsteDb: BackupRun | null;
  laatsteDbOk: BackupRun | null;
  laatsteBestanden: BackupRun | null;
  heartbeat: { op: string; bron: string } | null;
  runs: BackupRun[];
}

type Rij = {
  id: string;
  soort: 'db' | 'bestanden';
  bron: string;
  gestart: string;
  klaar: string | null;
  status: BackupRun['status'];
  bestand: string | null;
  drive_id: string | null;
  grootte: number | null;
  sleutel_id: string | null;
  tellingen: Record<string, unknown> | null;
  fout: string | null;
};

function naarRun(r: Rij): BackupRun {
  return {
    id: r.id,
    soort: r.soort,
    bron: r.bron,
    gestart: r.gestart,
    klaar: r.klaar,
    status: r.status,
    bestand: r.bestand,
    grootte: r.grootte,
    sleutelId: r.sleutel_id,
    tellingen: r.tellingen ?? {},
    fout: r.fout,
    downloadbaar: r.soort === 'db' && r.status === 'ok' && Boolean(r.drive_id)
  };
}

const KOLOMMEN = 'id, soort, bron, gestart, klaar, status, bestand, drive_id, grootte, sleutel_id, tellingen, fout';

export async function backupStatus(sb: SupabaseClient): Promise<BackupStatus> {
  const basis: BackupStatus = {
    migratie: true,
    ontbreekt: backupOntbreekt(),
    sleutelId: huidigSleutelId(),
    laatsteDb: null,
    laatsteDbOk: null,
    laatsteBestanden: null,
    heartbeat: null,
    runs: []
  };
  const [runs, dbOk, best, hb] = await Promise.all([
    sb.from('backup_runs').select(KOLOMMEN).order('gestart', { ascending: false }).limit(20),
    sb.from('backup_runs').select(KOLOMMEN).eq('soort', 'db').eq('status', 'ok').order('gestart', { ascending: false }).limit(1).maybeSingle(),
    sb.from('backup_runs').select(KOLOMMEN).eq('soort', 'bestanden').neq('status', 'overgeslagen').order('gestart', { ascending: false }).limit(1).maybeSingle(),
    sb.from('heartbeat').select('op, bron').order('op', { ascending: false }).limit(1).maybeSingle()
  ]);
  if (runs.error) {
    if (tabelOntbreekt(runs.error)) return { ...basis, migratie: false };
    throw runs.error;
  }
  const lijst = ((runs.data ?? []) as Rij[]).map(naarRun);
  return {
    ...basis,
    runs: lijst,
    laatsteDb: lijst.find((r) => r.soort === 'db' && r.status !== 'overgeslagen') ?? null,
    laatsteDbOk: dbOk.data ? naarRun(dbOk.data as Rij) : null,
    laatsteBestanden: best.data ? naarRun(best.data as Rij) : null,
    heartbeat: hb.data ? (hb.data as { op: string; bron: string }) : null
  };
}

export interface BackupWaarschuwing {
  soort: 'mislukt' | 'oud' | 'heartbeat' | 'niet_ingericht';
  tekst: string;
}

const UUR = 3_600_000;

/** Wat de eigenaar op het dashboard moet zien (null = alles in orde). Zuiver op de status. */
export function waarschuwingVan(s: BackupStatus, nu: number = Date.now()): BackupWaarschuwing | null {
  if (!s.migratie) return { soort: 'niet_ingericht', tekst: 'Back-ups staan nog niet aan: voer supabase/UITVOEREN_0026.sql uit.' };
  if (s.ontbreekt.some((n) => n.startsWith('BACKUP_ENCRYPTION_KEY') || n.startsWith('CRON_SECRET'))) {
    return { soort: 'niet_ingericht', tekst: `Back-ups staan nog niet aan: ${s.ontbreekt.filter((n) => /^(BACKUP|CRON)/.test(n)).join(' en ')} ontbreekt in Vercel.` };
  }
  if (s.laatsteDb?.status === 'mislukt') {
    return { soort: 'mislukt', tekst: `De laatste back-up is mislukt (${new Date(s.laatsteDb.gestart).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}).` };
  }
  const okOp = s.laatsteDbOk ? new Date(s.laatsteDbOk.gestart).getTime() : null;
  if (okOp === null) return { soort: 'oud', tekst: 'Er is nog geen geslaagde back-up.' };
  if (nu - okOp > 48 * UUR) return { soort: 'oud', tekst: 'De laatste geslaagde back-up is ouder dan 2 dagen.' };
  const hbOp = s.heartbeat ? new Date(s.heartbeat.op).getTime() : null;
  if (hbOp === null || nu - hbOp > 72 * UUR) {
    return { soort: 'heartbeat', tekst: 'De keep-alive heeft al meer dan 3 dagen niets gedaan: Supabase kan pauzeren.' };
  }
  return null;
}
