import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Teamlid } from '@/lib/auth/team';
import { mailboxVoor } from '@/lib/mail/mailboxen';
import { SJABLOON_KOLOMMEN, type SjabloonRij } from './terugkerend';
import type { Interval, TerugkerendRegel, TerugkerendWaarde } from './terugkerend-kern';

// Het beheerscherm van terugkerende facturen (/facturen/terugkerend): wat de pagina's en
// routes nodig hebben. Alleen de server leest terugkerende_facturen (service-role, RLS
// zonder policies), altijd ná de teamcheck.

export const NA_0036 = 'Terugkerende facturen werken zodra migratie 0036 is uitgevoerd (supabase/UITVOEREN_0036.sql in de SQL Editor van Supabase).';

export interface TerugkerendFactuurDto {
  id: string;
  nummer: string;
  datum: string;
  totaal: number;
  periode: string | null;
  verzondenOp: string | null;
  verzondenAan: string | null;
  /** Aangemaakt maar nog niet verstuurd: wacht op akkoord (0038). */
  wachtOpAkkoord: boolean;
}

export interface TerugkerendDto {
  id: string;
  klantId: string;
  klantNaam: string;
  klantTav: string;
  klantAdres: string;
  klantPostcode: string;
  naam: string;
  regels: TerugkerendRegel[];
  middenKolomLabel: string;
  btwVerlegd: boolean;
  btwVerlegdAls: 'verlegd' | 'nvt';
  btwVerlegdReden: string;
  interval: Interval;
  dag: number;
  volgendeDatum: string;
  eindDatum: string | null;
  actief: boolean;
  versturen: boolean;
  emailAan: string;
  emailCc: string;
  mailboxId: string;
  onderwerp: string;
  bericht: string;
  laatsteFout: string | null;
  laatstUitgevoerdOp: string | null;
  /** Akkoord vooraf (0038): het vinkje, en voor welke geplande datum er akkoord is. */
  akkoordVereist: boolean;
  akkoordPeriode: string | null;
  facturen: TerugkerendFactuurDto[];
}

interface KlantRij {
  id: string;
  company_name: string;
  contact_name: string | null;
  address: string | null;
  postal_code: string | null;
}

/** Zonder de akkoordkolommen van 0038 (om een schrijfactie vóór die migratie nog te laten lukken). */
export function zonder0038<T extends Record<string, unknown>>(rij: T): T {
  const kopie: Record<string, unknown> = { ...rij };
  for (const k of ['akkoord_vereist', 'akkoord_periode', 'akkoord_door', 'akkoord_op']) delete kopie[k];
  return kopie as T;
}

export function tabelOntbreekt(error: { code?: string } | null): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703'));
}

function naarDto(s: SjabloonRij, klant: KlantRij | undefined, facturen: TerugkerendFactuurDto[]): TerugkerendDto {
  return {
    id: s.id,
    klantId: s.client_id,
    klantNaam: klant?.company_name ?? 'Onbekende klant',
    klantTav: klant?.contact_name ?? '',
    klantAdres: klant?.address ?? '',
    klantPostcode: klant?.postal_code ?? '',
    naam: s.naam,
    regels: Array.isArray(s.regels) ? s.regels : [],
    middenKolomLabel: s.midden_kolom_label,
    btwVerlegd: s.btw_verlegd,
    btwVerlegdAls: s.btw_verlegd_als,
    btwVerlegdReden: s.btw_verlegd_reden,
    interval: s.interval,
    dag: s.dag,
    volgendeDatum: s.volgende_datum,
    eindDatum: s.eind_datum,
    actief: s.actief,
    versturen: s.versturen,
    emailAan: s.email_aan,
    emailCc: s.email_cc,
    mailboxId: s.mailbox_id,
    onderwerp: s.onderwerp,
    bericht: s.bericht,
    laatsteFout: s.laatste_fout,
    laatstUitgevoerdOp: s.laatst_uitgevoerd_op,
    akkoordVereist: s.akkoord_vereist === true,
    akkoordPeriode: s.akkoord_periode ?? null,
    facturen
  };
}

/**
 * Alle sjablonen met hun klantgegevens en de facturen die ze maakten; met `id` alleen dat
 * sjabloon. Null = vóór 0036.
 */
export async function laadBeheer(
  service: SupabaseClient,
  id?: string
): Promise<{ sjablonen: TerugkerendDto[] } | null> {
  let q = service.from('terugkerende_facturen').select(SJABLOON_KOLOMMEN).order('actief', { ascending: false }).order('volgende_datum', { ascending: true });
  if (id) q = q.eq('id', id);
  const [sjablonen, klanten, facturen] = await Promise.all([
    q,
    service.from('clients').select('id, company_name, contact_name, address, postal_code'),
    service
      .from('invoices')
      // Alle kolommen: wacht_op_akkoord (0038) bestaat vóór die migratie nog niet.
      .select('*')
      .not('terugkerend_id', 'is', null)
      .order('issued_at', { ascending: false })
      .limit(500)
  ]);
  if (sjablonen.error || facturen.error) {
    if (tabelOntbreekt(sjablonen.error) || tabelOntbreekt(facturen.error)) return null;
    throw new Error((sjablonen.error ?? facturen.error)?.message);
  }
  const klantRijen = (klanten.data ?? []) as KlantRij[];
  const perId = new Map(klantRijen.map((k) => [k.id, k]));
  const perSjabloon = new Map<string, TerugkerendFactuurDto[]>();
  for (const f of (facturen.data ?? []) as Record<string, unknown>[]) {
    const lijst = perSjabloon.get(f.terugkerend_id as string) ?? [];
    lijst.push({
      id: f.id as string,
      nummer: f.invoice_number as string,
      datum: String(f.issued_at).slice(0, 10),
      totaal: Number(f.total),
      periode: (f.terugkerend_periode as string | null) ?? null,
      verzondenOp: (f.verzonden_op as string | null) ?? null,
      verzondenAan: (f.verzonden_aan as string | null) ?? null,
      wachtOpAkkoord: f.wacht_op_akkoord === true
    });
    perSjabloon.set(f.terugkerend_id as string, lijst);
  }
  return {
    sjablonen: ((sjablonen.data ?? []) as unknown as SjabloonRij[]).map((s) => naarDto(s, perId.get(s.client_id), perSjabloon.get(s.id) ?? []))
  };
}

/** Mag dit teamlid vanaf deze inbox laten versturen? Alleen een zichtbare, werkende inbox (geen oude koppeling). */
export async function controleerMailbox(lid: Teamlid, waarde: TerugkerendWaarde): Promise<string | null> {
  if (!waarde.versturen && !waarde.mailbox_id) return null;
  const m = await mailboxVoor(lid, waarde.mailbox_id);
  if (!m || m.soort === 'oud') return 'Kies een inbox die bij Mail gekoppeld is.';
  if (!m.cfg) return `De inbox ${m.email} moet opnieuw gekoppeld worden (via Account & mail).`;
  return null;
}
