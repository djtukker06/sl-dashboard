import 'server-only';
import {
  AgendaFout,
  CRM_NIET_INGERICHT,
  dbFout,
  naarTaak,
  projectenLijst,
  projectOphalen,
  sorteerTaken,
  taakKolommen,
  type AgendaBron,
  type TaakDbRij
} from '@/lib/agenda/repo';
import { projectStatusVan } from '@/lib/agenda/teaminvoer';
import type { Project, ProjectStatus, Taak } from '@/lib/agenda/types';
import { kolomOntbreekt, tabelOntbreekt } from '@/lib/db/ontbreekt';
import { isRecentAfgerond } from './projectstatus';
import { likeLetterlijk } from './invoer';
import { belangrijksteStatus } from './opvolging';
import type { Klant, KlantNotitie, KlantRegel, KlantStatus } from './types';

// Database-toegang voor Klanten & projecten. Altijd met de gebruikerscliënt (RLS), ná de
// teamcheck in de pagina of route. Facturen worden alleen gelezen. Opvolgen (volgende
// stap, opvolgdatum, statusregels in de tijdlijn) vraagt 0025; daarvóór vallen de queries
// terug op de kolommen van 0022. Vereist migratie 0022; zonder die migratie gooit elke
// functie een AgendaFout 503 'tabel_ontbreekt' (de pagina toont dan "nog niet ingericht").
//
// Taken op de klant- en projectpagina zijn wat jij mag zien (RLS van 0022): taken in een
// project ziet het hele team, een losse taak alleen de maker en wie hem kreeg.

const KLANT_KOLOMMEN = 'id,company_name,contact_name,email,telefoon,address,postal_code,status,created_at';
const OPVOLG = ',volgende_stap,opvolgen_op';

interface KlantDbRij {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  telefoon?: string | null;
  address?: string | null;
  postal_code?: string | null;
  status: string | null;
  created_at?: string | null;
  volgende_stap?: string | null;
  opvolgen_op?: string | null;
}

function statusVan(s: unknown): KlantStatus {
  return s === 'lead' || s === 'afgerond' ? s : 'actief';
}

function naarKlant(r: KlantDbRij): Klant {
  return {
    id: r.id,
    naam: r.company_name,
    contactpersoon: r.contact_name ?? '',
    email: r.email ?? '',
    telefoon: r.telefoon ?? '',
    adres: r.address ?? '',
    postcode: r.postal_code ?? '',
    status: statusVan(r.status),
    volgendeStap: r.volgende_stap ?? '',
    opvolgenOp: r.opvolgen_op ?? null
  };
}

/** Fout van een CRM-query: zonder 0022 een nette 503, anders zoals de agenda. */
export function crmFout(error: unknown): AgendaFout {
  if (kolomOntbreekt(error)) return new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
  return dbFout(error);
}

/** Melding als je "volgende stap" of "opvolgen op" opslaat vóór migratie 0025. */
export const OPVOLGEN_NA_0025 = 'Opvolgen (volgende stap en datum) werkt zodra migratie 0025 is uitgevoerd (supabase/UITVOEREN_0025.sql).';

export function isNietIngericht(e: unknown): boolean {
  return e instanceof AgendaFout && e.code === 'tabel_ontbreekt';
}

type Antwoord<T> = PromiseLike<{ data: T | null; error: unknown }>;

/**
 * Probeert de kolomsets op volgorde en neemt de eerste die de database kent: zo werkt
 * dezelfde query vóór en na een migratie die alleen kolommen toevoegt (0025, 0012/0013).
 * Geeft ook terug welke set het werd (0 = de volledigste).
 */
async function metTerugval<T>(query: (kolommen: string) => Antwoord<T>, sets: string[]): Promise<{ data: T | null; set: number }> {
  for (let i = 0; i < sets.length; i++) {
    const r = await query(sets[i]);
    if (!r.error) return { data: r.data, set: i };
    const laatste = i === sets.length - 1;
    if (laatste || !kolomOntbreekt(r.error) || tabelOntbreekt(r.error)) throw crmFout(r.error);
  }
  return { data: null, set: sets.length };
}

// Alles wat niet afgerond is telt als lopend (ook de oude waarden gepland/actief).
const AFGEROND = '(afgerond,gearchiveerd)';

interface FactuurDbRij {
  id: string;
  client_id: string;
  invoice_number?: string;
  issued_at: string | null;
  total?: number | null;
  revenue_subtotal: number | null;
  deposit_percentage?: number | null;
  remainder_of_invoice_id?: string | null;
}

/** Open = aanbetaling zonder restfactuur (zelfde regel als het dashboard en het facturenoverzicht). */
function openAanbetalingen(rijen: FactuurDbRij[]): FactuurDbRij[] {
  const heeftRest = new Set(rijen.map((f) => f.remainder_of_invoice_id).filter(Boolean));
  return rijen.filter((f) => typeof f.deposit_percentage === 'number' && !heeftRest.has(f.id));
}

export interface KlantenOverzicht {
  klanten: KlantRegel[];
  /** false vóór migratie 0025: "volgende stap" en "opvolgen op" verbergen. */
  opvolging: boolean;
}

/**
 * Het klantenoverzicht in één ronde (vier kleine queries tegelijk): klanten, lopende
 * projecten, facturen (alleen bedragen, alleen lezen) en de laatste notities.
 */
export async function klantenLijst(bron: AgendaBron): Promise<KlantenOverzicht> {
  const [k, p, f, n] = await Promise.all([
    metTerugval<KlantDbRij[]>(
      (kol) => bron.sb.from('clients').select(kol).order('company_name').limit(2000) as unknown as Antwoord<KlantDbRij[]>,
      ['id,company_name,contact_name,email,telefoon,status,created_at' + OPVOLG, 'id,company_name,contact_name,email,telefoon,status,created_at']
    ),
    bron.sb.from('projects').select('client_id,status').not('status', 'in', AFGEROND).not('client_id', 'is', null).limit(5000),
    metTerugval<FactuurDbRij[]>(
      (kol) => bron.sb.from('invoices').select(kol).limit(10000) as unknown as Antwoord<FactuurDbRij[]>,
      ['id,client_id,issued_at,revenue_subtotal,deposit_percentage,remainder_of_invoice_id', 'id,client_id,issued_at,revenue_subtotal']
    ),
    metTerugval<{ client_id: string; created_at: string; soort?: string }[]>(
      (kol) =>
        bron.sb.from('client_notes').select(kol).order('created_at', { ascending: false }).limit(5000) as unknown as Antwoord<
          { client_id: string; created_at: string; soort?: string }[]
        >,
      ['client_id,created_at,soort', 'client_id,created_at']
    )
  ]);
  if (p.error) throw crmFout(p.error);

  const projecten = new Map<string, ProjectStatus[]>();
  for (const r of p.data ?? []) {
    const id = r.client_id as string;
    const lijst = projecten.get(id) ?? [];
    lijst.push(projectStatusVan(r.status) ?? 'bezig');
    projecten.set(id, lijst);
  }
  const facturen = (f.data ?? []) as FactuurDbRij[];
  const omzet = new Map<string, number>();
  const laatsteFactuur = new Map<string, string>();
  for (const r of facturen) {
    omzet.set(r.client_id, (omzet.get(r.client_id) ?? 0) + Number(r.revenue_subtotal || 0));
    if (r.issued_at && r.issued_at > (laatsteFactuur.get(r.client_id) ?? '')) laatsteFactuur.set(r.client_id, r.issued_at);
  }
  const open = new Map<string, number>();
  for (const r of openAanbetalingen(facturen)) open.set(r.client_id, (open.get(r.client_id) ?? 0) + 1);
  const laatsteNotitie = new Map<string, string>();
  for (const r of n.data ?? []) {
    if (r.soort === 'status') continue;
    if (!laatsteNotitie.has(r.client_id)) laatsteNotitie.set(r.client_id, r.created_at);
  }

  const klanten = (k.data ?? []).map((r): KlantRegel => {
    const statussen = projecten.get(r.id) ?? [];
    const contact = laatsteNotitie.get(r.id) ?? null;
    const actief = [r.created_at ?? '', contact ?? '', laatsteFactuur.get(r.id) ?? ''].sort().pop() || '';
    return {
      id: r.id,
      naam: r.company_name,
      contactpersoon: r.contact_name ?? '',
      email: r.email ?? '',
      telefoon: r.telefoon ?? '',
      status: statusVan(r.status),
      volgendeStap: r.volgende_stap ?? '',
      opvolgenOp: r.opvolgen_op ?? null,
      lopendeProjecten: statussen.length,
      projectStatus: belangrijksteStatus(statussen),
      omzet: Math.round((omzet.get(r.id) ?? 0) * 100) / 100,
      openAanbetalingen: open.get(r.id) ?? 0,
      laatsteContact: contact,
      laatstActief: actief
    };
  });
  klanten.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  return { klanten, opvolging: k.set === 0 };
}

export async function klantOphalen(bron: AgendaBron, id: string): Promise<Klant | null> {
  const r = await klantRijOphalen(bron, id);
  return r.rij ? naarKlant(r.rij) : null;
}

async function klantRijOphalen(bron: AgendaBron, id: string): Promise<{ rij: KlantDbRij | null; opvolging: boolean }> {
  const { data, set } = await metTerugval<KlantDbRij>(
    (kol) => bron.sb.from('clients').select(kol).eq('id', id).maybeSingle() as unknown as Antwoord<KlantDbRij>,
    [KLANT_KOLOMMEN + OPVOLG, KLANT_KOLOMMEN]
  );
  return { rij: data, opvolging: set === 0 };
}

export interface FactuurRegel {
  id: string;
  nummer: string;
  datum: string;
  totaal: number;
  /** Aanbetaling zonder restfactuur. */
  open: boolean;
}

export interface PrijsopgaveRegel {
  id: string;
  nummer: string;
  naam: string;
  datum: string;
  totaal: number;
}

export interface KlantCijfers {
  /** Omzet excl. btw over alle facturen. */
  omzet: number;
  /** Omzet excl. btw in het huidige jaar. */
  omzetDitJaar: number;
  aantalFacturen: number;
  openAanbetalingen: number;
  /** Bedrag (incl. btw) van de open aanbetalingen. */
  openBedrag: number;
}

export interface KlantPagina {
  klant: Klant;
  /** ISO-moment waarop de klant is aangemaakt. */
  aangemaakt: string | null;
  /** false vóór migratie 0025. */
  opvolging: boolean;
  notities: KlantNotitie[];
  projecten: Project[];
  /** Open taken bij deze klant of een van haar projecten (die jij mag zien). */
  taken: Taak[];
  /** De laatste facturen (nieuwste eerst, max. 50). */
  facturen: FactuurRegel[];
  cijfers: KlantCijfers;
  prijsopgaven: PrijsopgaveRegel[];
}

const LAATSTE = 5;

/**
 * Alles voor de klantpagina in twee rondes: (1) klant, notities, projecten en facturen
 * tegelijk; (2) open taken (via de projecten) en prijsopgaven (via de naam: prijsopgaven
 * hebben bewust geen koppeling met clients, zie 0011). Facturen worden alleen gelezen.
 */
export async function klantPagina(bron: AgendaBron, id: string, jaar: number = new Date().getFullYear()): Promise<KlantPagina | null> {
  const [klantRij, notities, projecten, facturen] = await Promise.all([
    klantRijOphalen(bron, id),
    metTerugval<{ id: string; tekst: string; created_by: string | null; created_at: string; soort?: string }[]>(
      (kol) =>
        bron.sb.from('client_notes').select(kol).eq('client_id', id).order('created_at', { ascending: false }).limit(200) as unknown as Antwoord<
          { id: string; tekst: string; created_by: string | null; created_at: string; soort?: string }[]
        >,
      ['id,tekst,created_by,created_at,soort', 'id,tekst,created_by,created_at']
    ),
    projectenLijst(bron, { selectie: 'alle', klantId: id, strikt: true }),
    metTerugval<FactuurDbRij[]>(
      (kol) =>
        bron.sb.from('invoices').select(kol).eq('client_id', id).order('issued_at', { ascending: false }).limit(1000) as unknown as Antwoord<FactuurDbRij[]>,
      [
        'id,client_id,invoice_number,issued_at,total,revenue_subtotal,deposit_percentage,remainder_of_invoice_id',
        'id,client_id,invoice_number,issued_at,total,revenue_subtotal'
      ]
    )
  ]);
  if (!klantRij.rij) return null;
  const klant = naarKlant(klantRij.rij);

  const projectIds = projecten.map((p) => p.id);
  let tq = bron.sb.from('tasks').select(taakKolommen(true)).is('completed_at', null).limit(300);
  tq = projectIds.length ? tq.or(`client_id.eq.${id},project_id.in.(${projectIds.join(',')})`) : tq.eq('client_id', id);
  const [taken, opgaven] = await Promise.all([
    tq,
    bron.sb
      .from('quotes')
      .select('id,quote_number,name,issued_at,total')
      .ilike('client_company_name', likeLetterlijk(klant.naam))
      .order('issued_at', { ascending: false })
      .limit(LAATSTE)
  ]);
  if (taken.error) throw crmFout(taken.error);
  if (opgaven.error) throw crmFout(opgaven.error);

  const alleFacturen = (facturen.data ?? []) as FactuurDbRij[];
  const openIds = new Set(openAanbetalingen(alleFacturen).map((f) => f.id));
  const cijfers: KlantCijfers = {
    omzet: 0,
    omzetDitJaar: 0,
    aantalFacturen: alleFacturen.length,
    openAanbetalingen: openIds.size,
    openBedrag: 0
  };
  for (const f of alleFacturen) {
    const bedrag = Number(f.revenue_subtotal || 0);
    cijfers.omzet += bedrag;
    if (f.issued_at && Number(f.issued_at.slice(0, 4)) === jaar) cijfers.omzetDitJaar += bedrag;
    if (openIds.has(f.id)) cijfers.openBedrag += Number(f.total || 0);
  }

  return {
    klant,
    aangemaakt: klantRij.rij.created_at ?? null,
    opvolging: klantRij.opvolging,
    notities: (notities.data ?? []).map((n) => ({
      id: n.id,
      tekst: n.tekst,
      door: n.created_by ?? null,
      op: n.created_at,
      soort: n.soort === 'status' ? 'status' : 'notitie'
    })),
    projecten,
    taken: ((taken.data ?? []) as unknown as TaakDbRij[]).map(naarTaak).sort(sorteerTaken),
    facturen: alleFacturen.slice(0, 50).map((f) => ({
      id: f.id,
      nummer: f.invoice_number ?? '',
      datum: f.issued_at ?? '',
      totaal: Number(f.total || 0),
      open: openIds.has(f.id)
    })),
    cijfers,
    prijsopgaven: (opgaven.data ?? []).map((q) => ({
      id: q.id as string,
      nummer: (q.quote_number as string | null) ?? '',
      naam: (q.name as string | null) ?? '',
      datum: q.issued_at as string,
      totaal: Number(q.total)
    }))
  };
}

export interface OpvolgRegel {
  id: string;
  naam: string;
  status: KlantStatus;
  volgendeStap: string;
  opvolgenOp: string;
}

/**
 * Dashboardkaart "Opvolgen": klanten en leads (niet afgerond) met een opvolgdatum van
 * vandaag of eerder. null vóór migratie 0025 (of 0022): de kaart verschijnt dan niet.
 */
export async function opvolgLijst(bron: AgendaBron, vandaag: string): Promise<OpvolgRegel[] | null> {
  if (!bron.team) return null;
  const { data, error } = await bron.sb
    .from('clients')
    .select('id,company_name,status,volgende_stap,opvolgen_op')
    .lte('opvolgen_op', vandaag)
    .neq('status', 'afgerond')
    .order('opvolgen_op')
    .limit(20);
  if (error) {
    if (kolomOntbreekt(error)) return null;
    throw crmFout(error);
  }
  return ((data ?? []) as KlantDbRij[]).map((r) => ({
    id: r.id,
    naam: r.company_name,
    status: statusVan(r.status),
    volgendeStap: r.volgende_stap ?? '',
    opvolgenOp: r.opvolgen_op as string
  }));
}

export interface ProjectPagina {
  project: Project;
  /** Alle taken van het project (open eerst, dan afgerond, nieuwste eerst). */
  taken: Taak[];
}

/** Projectpagina in één ronde: het project (met eigenaren en tellingen) en zijn taken. */
export async function projectPagina(bron: AgendaBron, id: string): Promise<ProjectPagina | null> {
  const [project, taken] = await Promise.all([
    projectOphalen(bron, id, true),
    bron.sb.from('tasks').select(taakKolommen(true)).eq('project_id', id).order('completed_at', { ascending: false, nullsFirst: true }).limit(500)
  ]);
  if (taken.error) throw crmFout(taken.error);
  if (!project) return null;
  const alle = ((taken.data ?? []) as unknown as TaakDbRij[]).map(naarTaak);
  const open = alle.filter((t) => !t.afgerond).sort(sorteerTaken);
  const af = alle.filter((t) => t.afgerond).sort((a, b) => ((a.afgerondOp ?? '') < (b.afgerondOp ?? '') ? 1 : -1));
  return { project, taken: [...open, ...af] };
}

export interface ProjectTellers {
  /** Aantal per status; 'afgerond' = afgerond in de laatste 30 dagen (vóór 0023: alle). */
  perStatus: Record<ProjectStatus, number>;
  /** Lopende projecten met een verstreken deadline. */
  teLaat: number;
}

/**
 * Tellers voor de dashboardkaart "Projecten" in één kleine query (alleen status, deadline
 * en status_sinds). Vóór 0023 zonder status_sinds; vóór 0022 een 503 'tabel_ontbreekt'.
 */
export async function projectTellers(bron: AgendaBron, vandaag: string, nu: Date = new Date()): Promise<ProjectTellers> {
  if (!bron.team) throw new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
  const haal = (k: string) => bron.sb.from('projects').select(k).limit(5000) as unknown as PromiseLike<{ data: TellerRij[] | null; error: unknown }>;
  let r = await haal('status,deadline,status_sinds');
  if (r.error && kolomOntbreekt(r.error) && !tabelOntbreekt(r.error)) r = await haal('status,deadline');
  if (r.error) throw crmFout(r.error);
  const perStatus: Record<ProjectStatus, number> = { voorbereiding: 0, bezig: 0, wachten: 0, afgerond: 0 };
  let teLaat = 0;
  for (const rij of r.data ?? []) {
    const status = projectStatusVan(rij.status) ?? 'bezig';
    if (status === 'afgerond') {
      if (isRecentAfgerond(rij.status_sinds ?? null, nu)) perStatus.afgerond++;
      continue;
    }
    perStatus[status]++;
    if (rij.deadline && rij.deadline < vandaag) teLaat++;
  }
  return { perStatus, teLaat };
}

interface TellerRij {
  status: string;
  deadline: string | null;
  status_sinds?: string | null;
}
