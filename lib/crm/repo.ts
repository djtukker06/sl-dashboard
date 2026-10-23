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
import type { Project, Taak } from '@/lib/agenda/types';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { likeLetterlijk } from './invoer';
import type { Klant, KlantNotitie, KlantRegel, KlantStatus } from './types';

// Database-toegang voor Klanten & projecten. Altijd met de gebruikerscliënt (RLS), ná de
// teamcheck in de pagina of route. Vereist migratie 0022; zonder die migratie gooit elke
// functie een AgendaFout 503 'tabel_ontbreekt' (de pagina toont dan "nog niet ingericht").
//
// Taken op de klant- en projectpagina zijn wat jij mag zien (RLS van 0022): taken in een
// project ziet het hele team, een losse taak alleen de maker en wie hem kreeg.

const KLANT_KOLOMMEN = 'id,company_name,contact_name,email,telefoon,address,postal_code,status';

interface KlantDbRij {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  telefoon?: string | null;
  address?: string | null;
  postal_code?: string | null;
  status: string | null;
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
    status: statusVan(r.status)
  };
}

/** Fout van een CRM-query: zonder 0022 een nette 503, anders zoals de agenda. */
export function crmFout(error: unknown): AgendaFout {
  if (kolomOntbreekt(error)) return new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
  return dbFout(error);
}

export function isNietIngericht(e: unknown): boolean {
  return e instanceof AgendaFout && e.code === 'tabel_ontbreekt';
}

const LOPEND = ['gepland', 'bezig', 'actief'];

/** Het klantenoverzicht: alle klanten met het aantal lopende projecten (één ronde). */
export async function klantenLijst(bron: AgendaBron): Promise<KlantRegel[]> {
  const [k, p] = await Promise.all([
    bron.sb.from('clients').select('id,company_name,contact_name,email,status').order('company_name').limit(2000),
    bron.sb.from('projects').select('client_id').in('status', LOPEND).not('client_id', 'is', null).limit(5000)
  ]);
  if (k.error) throw crmFout(k.error);
  if (p.error) throw crmFout(p.error);
  const lopend = new Map<string, number>();
  for (const r of p.data ?? []) lopend.set(r.client_id as string, (lopend.get(r.client_id as string) ?? 0) + 1);
  return ((k.data ?? []) as KlantDbRij[])
    .map((r) => ({
      id: r.id,
      naam: r.company_name,
      contactpersoon: r.contact_name ?? '',
      email: r.email ?? '',
      status: statusVan(r.status),
      lopendeProjecten: lopend.get(r.id) ?? 0
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export async function klantOphalen(bron: AgendaBron, id: string): Promise<Klant | null> {
  const { data, error } = await bron.sb.from('clients').select(KLANT_KOLOMMEN).eq('id', id).maybeSingle();
  if (error) throw crmFout(error);
  return data ? naarKlant(data as KlantDbRij) : null;
}

export interface FactuurRegel {
  id: string;
  nummer: string;
  datum: string;
  totaal: number;
}

export interface PrijsopgaveRegel {
  id: string;
  nummer: string;
  naam: string;
  datum: string;
  totaal: number;
}

export interface KlantPagina {
  klant: Klant;
  notities: KlantNotitie[];
  projecten: Project[];
  /** Open taken bij deze klant of een van haar projecten (die jij mag zien). */
  taken: Taak[];
  facturen: FactuurRegel[];
  aantalFacturen: number;
  prijsopgaven: PrijsopgaveRegel[];
}

const LAATSTE = 5;

/**
 * Alles voor de klantpagina in twee rondes: (1) klant, notities, projecten en facturen
 * tegelijk; (2) open taken (via de projecten) en prijsopgaven (via de naam: prijsopgaven
 * hebben bewust geen koppeling met clients, zie 0011).
 */
export async function klantPagina(bron: AgendaBron, id: string): Promise<KlantPagina | null> {
  const [klant, notities, projecten, facturen] = await Promise.all([
    klantOphalen(bron, id),
    bron.sb.from('client_notes').select('id,tekst,created_by,created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(200),
    projectenLijst(bron, { selectie: 'alle', klantId: id, strikt: true }),
    bron.sb
      .from('invoices')
      .select('id,invoice_number,issued_at,total', { count: 'exact' })
      .eq('client_id', id)
      .order('issued_at', { ascending: false })
      .limit(LAATSTE)
  ]);
  if (notities.error) throw crmFout(notities.error);
  if (facturen.error) throw crmFout(facturen.error);
  if (!klant) return null;

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

  return {
    klant,
    notities: (notities.data ?? []).map((n) => ({
      id: n.id as string,
      tekst: n.tekst as string,
      door: (n.created_by as string | null) ?? null,
      op: n.created_at as string
    })),
    projecten,
    taken: ((taken.data ?? []) as unknown as TaakDbRij[]).map(naarTaak).sort(sorteerTaken),
    facturen: (facturen.data ?? []).map((f) => ({
      id: f.id as string,
      nummer: f.invoice_number as string,
      datum: f.issued_at as string,
      totaal: Number(f.total)
    })),
    aantalFacturen: facturen.count ?? (facturen.data ?? []).length,
    prijsopgaven: (opgaven.data ?? []).map((q) => ({
      id: q.id as string,
      nummer: (q.quote_number as string | null) ?? '',
      naam: (q.name as string | null) ?? '',
      datum: q.issued_at as string,
      totaal: Number(q.total)
    }))
  };
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
