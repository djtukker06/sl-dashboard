import type { SupabaseClient } from '@supabase/supabase-js';
import { dbFout, isUuid, UitgavenFout } from './api';
import {
  AI_VELDEN,
  isBestandsType,
  isBetaalwijze,
  isBtwTarief,
  isCategorie,
  isDatum,
  isStatus,
  leesBedrag,
  schoon,
  type AiVeld,
  type Leverancier,
  type Uitgave,
  type UitgaveBestand,
  type UitgaveInvoer
} from './model';

// Database-toegang voor uitgaven. Altijd met de gebruikerscliënt (RLS), ná de
// sessiecheck in de route. De tabel clients wordt alleen gelezen (naam bij een koppeling).

export const KOLOMMEN =
  'id,expense_date,supplier,description,category,total_amount,vat_amount,vat_rate,currency,invoice_number,' +
  'payment_method,client_id,project_note,notes,status,ai_fields,ai_status,ai_message,source,source_ref,' +
  'created_at,updated_at,client:clients(company_name),files:expense_files(id,file_name,mime_type,size_bytes,storage_path,created_at)';

type KlantJoin = { company_name: string | null } | { company_name: string | null }[] | null;

export interface BestandRij {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  storage_path: string;
  created_at: string;
}

export interface UitgaveRij {
  id: string;
  expense_date: string | null;
  supplier: string;
  description: string;
  category: string | null;
  total_amount: number | string | null;
  vat_amount: number | string | null;
  vat_rate: string | null;
  currency: string;
  invoice_number: string;
  payment_method: string | null;
  client_id: string | null;
  project_note: string;
  notes: string;
  status: string;
  ai_fields: string[] | null;
  ai_status: string;
  ai_message: string;
  source: string;
  source_ref: string;
  created_at: string;
  updated_at: string;
  client?: KlantJoin;
  files?: BestandRij[] | null;
}

const getal = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));

export function naarUitgave(r: UitgaveRij): Uitgave {
  const klant = Array.isArray(r.client) ? r.client[0] : r.client;
  const bestanden: UitgaveBestand[] = [...(r.files ?? [])]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .filter((f) => isBestandsType(f.mime_type))
    .map((f) => ({ id: f.id, naam: f.file_name, type: f.mime_type as UitgaveBestand['type'], grootte: f.size_bytes }));
  return {
    id: r.id,
    datum: r.expense_date,
    leverancier: r.supplier,
    omschrijving: r.description,
    categorie: isCategorie(r.category) ? r.category : null,
    totaal: getal(r.total_amount),
    btwBedrag: getal(r.vat_amount),
    btwTarief: isBtwTarief(r.vat_rate) ? r.vat_rate : null,
    valuta: r.currency,
    factuurnummer: r.invoice_number,
    betaaldVia: isBetaalwijze(r.payment_method) ? r.payment_method : null,
    klantId: r.client_id,
    klantNaam: klant?.company_name ?? null,
    projectNotitie: r.project_note,
    notitie: r.notes,
    status: isStatus(r.status) ? r.status : 'concept',
    aiVelden: (r.ai_fields ?? []).filter((v): v is AiVeld => (AI_VELDEN as readonly string[]).includes(v)),
    aiStatus: r.ai_status === 'klaar' || r.ai_status === 'mislukt' ? r.ai_status : 'geen',
    aiMelding: r.ai_message,
    bron: r.source === 'mail' || r.source === 'handmatig' ? r.source : 'upload',
    bronInfo: r.source_ref,
    bestanden,
    aangemaakt: r.created_at,
    gewijzigd: r.updated_at
  };
}

type Kolommen = Record<string, unknown>;

/**
 * Zet invoer van de client om naar kolommen. Alleen meegestuurde velden komen erin.
 * Geeft een foutmelding bij ongeldige waarden.
 */
export function parseInvoer(b: UitgaveInvoer): { ok: true; waarde: Kolommen } | { ok: false; fout: string } {
  const k: Kolommen = {};
  const heeft = (veld: keyof UitgaveInvoer) => Object.prototype.hasOwnProperty.call(b, veld);

  if (heeft('datum')) {
    if (b.datum === null || b.datum === '') k.expense_date = null;
    else if (isDatum(b.datum)) k.expense_date = b.datum;
    else return { ok: false, fout: 'Ongeldige datum.' };
  }
  if (heeft('leverancier')) k.supplier = schoon(b.leverancier, 200);
  if (heeft('omschrijving')) k.description = schoon(b.omschrijving, 500);
  if (heeft('factuurnummer')) k.invoice_number = schoon(b.factuurnummer, 100);
  if (heeft('projectNotitie')) k.project_note = schoon(b.projectNotitie, 300);
  if (heeft('notitie')) k.notes = typeof b.notitie === 'string' ? b.notitie.slice(0, 10000) : '';
  if (heeft('categorie')) {
    if (b.categorie === null || b.categorie === '') k.category = null;
    else if (isCategorie(b.categorie)) k.category = b.categorie;
    else return { ok: false, fout: 'Onbekende categorie.' };
  }
  if (heeft('btwTarief')) {
    if (b.btwTarief === null || b.btwTarief === '') k.vat_rate = null;
    else if (isBtwTarief(b.btwTarief)) k.vat_rate = b.btwTarief;
    else return { ok: false, fout: 'Onbekend btw-tarief.' };
  }
  if (heeft('betaaldVia')) {
    if (b.betaaldVia === null || b.betaaldVia === '') k.payment_method = null;
    else if (isBetaalwijze(b.betaaldVia)) k.payment_method = b.betaaldVia;
    else return { ok: false, fout: 'Onbekende betaalwijze.' };
  }
  for (const [veld, kolom, label] of [
    ['totaal', 'total_amount', 'Het bedrag'],
    ['btwBedrag', 'vat_amount', 'Het btw-bedrag']
  ] as const) {
    if (!heeft(veld)) continue;
    const ruw = b[veld];
    if (ruw === null || ruw === '') {
      k[kolom] = null;
      continue;
    }
    const n = leesBedrag(ruw);
    if (n === null || Math.abs(n) >= 1_000_000) return { ok: false, fout: `${label} is ongeldig.` };
    k[kolom] = n;
  }
  if (typeof k.total_amount === 'number' && typeof k.vat_amount === 'number' && Math.abs(k.vat_amount) > Math.abs(k.total_amount)) {
    return { ok: false, fout: 'Het btw-bedrag kan niet hoger zijn dan het totaal.' };
  }
  if (heeft('valuta')) {
    const v = String(b.valuta ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(v)) return { ok: false, fout: 'Valuta is een code van 3 letters, bv. EUR.' };
    k.currency = v;
  }
  if (heeft('klantId')) {
    if (b.klantId === null || b.klantId === '') k.client_id = null;
    else if (isUuid(b.klantId)) k.client_id = b.klantId;
    else return { ok: false, fout: 'Ongeldige klant.' };
  }
  if (heeft('status')) {
    if (!isStatus(b.status)) return { ok: false, fout: 'Onbekende status.' };
    k.status = b.status;
  }
  if (heeft('aiVelden')) {
    k.ai_fields = Array.isArray(b.aiVelden)
      ? [...new Set(b.aiVelden.filter((v) => (AI_VELDEN as readonly string[]).includes(v)))]
      : [];
  }
  return { ok: true, waarde: k };
}

export async function haalUitgave(sb: SupabaseClient, id: string): Promise<{ uitgave: Uitgave; rij: UitgaveRij } | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await sb.from('expenses').select(KOLOMMEN).eq('id', id).maybeSingle();
  if (error) throw dbFout(error);
  if (!data) return null;
  const rij = data as unknown as UitgaveRij;
  return { uitgave: naarUitgave(rij), rij };
}

export async function moetUitgave(sb: SupabaseClient, id: string) {
  const r = await haalUitgave(sb, id);
  if (!r) throw new UitgavenFout(404, 'Deze uitgave bestaat niet (meer).');
  return r;
}

/**
 * Uitgaven in een periode (op datum), plus alle concepten zonder datum (die moeten
 * altijd zichtbaar blijven tot ze gecontroleerd zijn).
 */
export async function uitgavenInPeriode(sb: SupabaseClient, van: string, tot: string, metZonderDatum = true): Promise<Uitgave[]> {
  const verzoeken = [
    sb.from('expenses').select(KOLOMMEN).gte('expense_date', van).lte('expense_date', tot).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(3000)
  ];
  if (metZonderDatum) {
    verzoeken.push(sb.from('expenses').select(KOLOMMEN).is('expense_date', null).order('created_at', { ascending: false }).limit(500));
  }
  const res = await Promise.all(verzoeken);
  for (const r of res) if (r.error) throw dbFout(r.error);
  const rijen = res.flatMap((r) => (r.data ?? []) as unknown as UitgaveRij[]);
  return rijen.map(naarUitgave);
}

/** Bestanden van een uitgave, met opslagpad (alleen server-kant). */
export async function bestandenVan(sb: SupabaseClient, uitgaveId: string): Promise<BestandRij[]> {
  const { data, error } = await sb
    .from('expense_files')
    .select('id,file_name,mime_type,size_bytes,storage_path,created_at')
    .eq('expense_id', uitgaveId)
    .order('created_at');
  if (error) throw dbFout(error);
  return (data ?? []) as BestandRij[];
}

/**
 * Bekende leveranciers met hun laatst gebruikte categorie en betaalwijze (de nieuwste
 * uitgave met een ingevulde waarde wint), gesorteerd op hoe vaak ze voorkomen.
 */
export async function leveranciers(sb: SupabaseClient): Promise<Leverancier[]> {
  const { data, error } = await sb
    .from('expenses')
    .select('supplier,category,payment_method,updated_at')
    .neq('supplier', '')
    .order('updated_at', { ascending: false })
    .limit(3000);
  if (error) throw dbFout(error);
  const map = new Map<string, Leverancier>();
  for (const r of (data ?? []) as { supplier: string; category: string | null; payment_method: string | null }[]) {
    const sleutel = r.supplier.trim().toLowerCase();
    if (!sleutel) continue;
    const l = map.get(sleutel);
    if (!l) {
      map.set(sleutel, {
        naam: r.supplier.trim(),
        categorie: isCategorie(r.category) ? r.category : null,
        betaaldVia: isBetaalwijze(r.payment_method) ? r.payment_method : null,
        aantal: 1
      });
    } else {
      l.aantal++;
      if (!l.categorie && isCategorie(r.category)) l.categorie = r.category;
      if (!l.betaaldVia && isBetaalwijze(r.payment_method)) l.betaaldVia = r.payment_method;
    }
  }
  return [...map.values()].sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam, 'nl'));
}
