import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { naarCenten } from '../kern/geld';
import { isBtwCode } from '../kern/btw';
import { isKwartaal } from '../kern/periode';
import { isImportFormaat, type Boeking, type BoekingWaarde, type Grootboekrekening, type ImportFormaat, type Instellingen, type Rekening, type Stamdata, type Vennoot } from '../model';
import { bronExtraUitRij, factuurUitRij, isKoppelBron, uitgaveUitRij, type BronExtra, type FactuurBron, type KoppelBron, type Koppeling, type UitgaveBron } from '../kern/bronnen';
import type { ImportBoeking, Kolommapping } from '../kern/bankimport';
import { BoekhoudFout, type BoekhoudRepo, type RekeningInvoer, type RekeningWijziging } from './types';
import { leesSnapshot, type Aangifte, type AangifteBetaling, type AangifteSnapshot } from '../kern/aangifte';
import { isActivumCategorie, type Activum, type ActivumWaarde } from '../kern/afschrijving';
import type { Kwartaal } from '../kern/periode';

// De echte opslag: tabellen bk_* (migratie 0027) via de gebruikerscliënt van het teamlid,
// dus met RLS (is_teamlid() + 2FA). Nooit de service-role. Bedragen komen als bigint
// (centen) terug; PostgREST geeft die als JSON-number (veilig tot 2^53).

export const NIET_INGERICHT = 'De boekhouding is nog niet ingericht: voer in Supabase supabase/UITVOEREN_0027.sql uit.';

/** Zet een databasefout om naar een nette BoekhoudFout. */
export function bkDbFout(error: unknown): BoekhoudFout {
  if (tabelOntbreekt(error)) return new BoekhoudFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  const e = (error ?? {}) as { code?: string; message?: string };
  const msg = String(e.message ?? '');
  if (msg.startsWith('periode_vergrendeld:')) {
    return new BoekhoudFout(409, 'Deze periode is vergrendeld: de btw-aangifte is ingediend of het boekjaar is afgesloten.', 'periode_vergrendeld');
  }
  if (msg.startsWith('memoriaal_sluit_niet:')) return new BoekhoudFout(400, 'De memoriaalpost sluit niet (debet ≠ credit).', 'sluit_niet');
  if (msg.startsWith('grootboek_systeem:')) return new BoekhoudFout(400, 'Dit is een vaste rekening van het systeem.', 'grootboek_systeem');
  if (msg.startsWith('grootboek_in_gebruik:')) return new BoekhoudFout(400, 'Deze rekening is in gebruik.', 'grootboek_in_gebruik');
  if (msg.startsWith('geen_vrije_rekening:')) return new BoekhoudFout(400, 'Er kunnen maximaal 10 bankrekeningen zijn.', 'te_veel');
  if (msg.startsWith('rekening_onbekend')) return new BoekhoudFout(404, 'Die rekening bestaat niet (meer) of is niet actief.', 'onbekend');
  if (msg.startsWith('koppeling_ongeldig:')) return new BoekhoudFout(400, 'Deze koppeling past niet bij de boeking (soort of verwijderd).', 'koppeling_ongeldig');
  if (e.code === '23505') return new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
  if (e.code === '23514') return new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
  if (e.code === '23503') return new BoekhoudFout(400, 'Een gekozen rekening, categorie of vennoot bestaat niet (meer).', 'ongeldig');
  if (e.code === '42501') return new BoekhoudFout(403, 'Geen toegang.', 'geen_toegang');
  if (e.code === '22P02' || e.code === '22003' || e.code === '22007' || e.code === '22008') return new BoekhoudFout(400, 'Ongeldige invoer.', 'ongeldig');
  logFout('[boekhouding]', error);
  return new BoekhoudFout(500, 'Er ging iets mis bij het opslaan of ophalen van de boekhouding.');
}

const centen = (v: unknown): number => {
  const c = naarCenten(v);
  return c === null ? 0 : c;
};

type Rij = Record<string, unknown>;

function naarRekening(r: Rij): Rekening {
  return {
    id: String(r.id),
    naam: String(r.naam),
    iban: (r.iban as string | null) ?? null,
    grootboek: String(r.grootboek_code),
    standaard: r.standaard === true,
    importFormaat: isImportFormaat(r.import_formaat) ? r.import_formaat : 'generiek',
    beginsaldo: centen(r.beginsaldo_centen),
    begindatum: (r.beginsaldo_datum as string | null) ?? null,
    actief: r.actief !== false,
    volgorde: Number(r.volgorde ?? 0),
    importMapping: r.import_mapping && typeof r.import_mapping === 'object' ? (r.import_mapping as Record<string, unknown>) : null
  };
}

function naarGrootboek(r: Rij): Grootboekrekening {
  return {
    code: String(r.code),
    naam: String(r.naam),
    soort: r.soort as Grootboekrekening['soort'],
    rubriek: String(r.rubriek ?? 'overig'),
    rgs: (r.rgs_code as string | null) ?? null,
    btw: isBtwCode(r.btw_standaard) ? r.btw_standaard : null,
    systeem: r.systeem === true,
    actief: r.actief !== false,
    hint: (r.hint as string | null) ?? null,
    volgorde: Number(r.volgorde ?? 0)
  };
}

function naarVennoot(r: Rij): Vennoot {
  return {
    id: String(r.id),
    naam: String(r.naam),
    userId: (r.user_id as string | null) ?? null,
    aandeel: Number(r.winstaandeel ?? 0),
    grootboekKapitaal: String(r.grootboek_kapitaal),
    grootboekPrive: String(r.grootboek_prive),
    actief: r.actief !== false
  };
}

const BOEKING_KOLOMMEN =
  'id, rekening_id, datum, omschrijving, tegenpartij, tegenrekening, soort, richting, bedrag_centen, bedrag_is_excl, btw_code, btw_centen, btw_handmatig, grootboek_code, vennoot_id, status, kenmerk, notities, import_id, created_at, created_by, updated_at';

function naarBoeking(r: Rij): Boeking {
  return {
    id: String(r.id),
    rekeningId: (r.rekening_id as string | null) ?? null,
    datum: String(r.datum),
    omschrijving: String(r.omschrijving),
    tegenpartij: (r.tegenpartij as string | null) ?? null,
    tegenrekening: (r.tegenrekening as string | null) ?? null,
    soort: r.soort as Boeking['soort'],
    richting: r.richting === 'bij' ? 'bij' : 'af',
    bedrag: centen(r.bedrag_centen),
    isExcl: r.bedrag_is_excl === true,
    btwCode: isBtwCode(r.btw_code) ? r.btw_code : 'geen',
    btw: centen(r.btw_centen),
    btwHandmatig: r.btw_handmatig === true,
    grootboek: (r.grootboek_code as string | null) ?? null,
    vennootId: (r.vennoot_id as string | null) ?? null,
    status: r.status === 'te_verwerken' ? 'te_verwerken' : 'geboekt',
    kenmerk: (r.kenmerk as string | null) ?? null,
    notities: (r.notities as string | null) ?? null,
    importId: (r.import_id as string | null) ?? null,
    aangemaakt: String(r.created_at),
    aangemaaktDoor: (r.created_by as string | null) ?? null,
    gewijzigd: String(r.updated_at)
  };
}

function naarRij(w: BoekingWaarde): Rij {
  return {
    rekening_id: w.rekeningId,
    datum: w.datum,
    omschrijving: w.omschrijving,
    tegenpartij: w.tegenpartij,
    soort: w.soort,
    richting: w.richting,
    bedrag_centen: w.bedrag,
    bedrag_is_excl: w.isExcl,
    btw_code: w.btwCode,
    btw_centen: w.btw,
    btw_handmatig: w.btwHandmatig,
    grootboek_code: w.grootboek,
    vennoot_id: w.vennootId,
    status: w.status,
    notities: w.notities
  };
}

const AANGIFTE_KOLOMMEN = 'id, jaar, kwartaal, rubrieken, te_betalen_centen, ingediend_op, ingediend_door, kenmerk, opmerking';

function naarAangifte(r: Rij): Aangifte | null {
  const q = Number(r.kwartaal);
  if (!isKwartaal(q)) return null;
  return {
    id: String(r.id),
    jaar: Number(r.jaar),
    kwartaal: q,
    ingediendOp: String(r.ingediend_op),
    ingediendDoor: (r.ingediend_door as string | null) ?? null,
    kenmerk: (r.kenmerk as string | null) ?? null,
    opmerking: (r.opmerking as string | null) ?? null,
    snapshot: leesSnapshot(r.rubrieken),
    teBetalen: centen(r.te_betalen_centen)
  };
}

const ACTIVUM_KOLOMMEN =
  'id, omschrijving, categorie_grootboek, aanschafdatum, ingebruikname, aanschaf_centen, restwaarde_centen, looptijd_maanden, uitgave_id, boeking_id, desinvestering_datum, desinvestering_centen, notities, created_at';

function naarActivum(r: Rij): Activum | null {
  if (!isActivumCategorie(r.categorie_grootboek)) return null;
  return {
    id: String(r.id),
    omschrijving: String(r.omschrijving),
    categorie: r.categorie_grootboek,
    aanschafdatum: String(r.aanschafdatum),
    ingebruikname: String(r.ingebruikname),
    aanschaf: centen(r.aanschaf_centen),
    restwaarde: centen(r.restwaarde_centen),
    looptijdMaanden: Number(r.looptijd_maanden),
    uitgaveId: (r.uitgave_id as string | null) ?? null,
    boekingId: (r.boeking_id as string | null) ?? null,
    desinvesteringDatum: (r.desinvestering_datum as string | null) ?? null,
    desinvesteringOpbrengst: r.desinvestering_centen === null || r.desinvestering_centen === undefined ? null : centen(r.desinvestering_centen),
    notities: (r.notities as string | null) ?? null,
    aangemaakt: String(r.created_at)
  };
}

function activumRij(w: ActivumWaarde): Rij {
  return {
    omschrijving: w.omschrijving,
    categorie_grootboek: w.categorie,
    aanschafdatum: w.aanschafdatum,
    ingebruikname: w.ingebruikname,
    aanschaf_centen: w.aanschaf,
    restwaarde_centen: w.restwaarde,
    looptijd_maanden: w.looptijdMaanden,
    uitgave_id: w.uitgaveId,
    boeking_id: w.boekingId,
    desinvestering_datum: w.desinvesteringDatum,
    desinvestering_centen: w.desinvesteringOpbrengst,
    notities: w.notities
  };
}

export class SupabaseRepo implements BoekhoudRepo {
  readonly modus = 'live' as const;
  private sb: SupabaseClient;
  private userId: string;
  constructor(sb: SupabaseClient, userId: string) {
    this.sb = sb;
    this.userId = userId;
  }

  async stamdata(): Promise<Stamdata> {
    const [inst, rek, gb, ven, aang, jaren] = await Promise.all([
      this.sb.from('bk_instellingen').select('*').eq('id', 1).maybeSingle(),
      this.sb.from('bk_rekeningen').select('*').order('volgorde').order('naam'),
      this.sb.from('bk_grootboek').select('*').order('code'),
      this.sb.from('bk_vennoten').select('*').order('naam'),
      this.sb.from('bk_aangiften').select('jaar, kwartaal'),
      this.sb.from('bk_boekjaren').select('jaar')
    ]);
    for (const r of [inst, rek, gb, ven, aang, jaren]) if (r.error) throw bkDbFout(r.error);
    const i = (inst.data ?? {}) as Rij;
    const instellingen: Instellingen = {
      bedrijfsnaam: String(i.bedrijfsnaam ?? 'Studio Levant'),
      rechtsvorm: String(i.rechtsvorm ?? 'vof'),
      kvk: (i.kvk as string | null) ?? null,
      btwNummer: (i.btw_nummer as string | null) ?? null,
      startdatum: (i.startdatum as string | null) ?? null,
      kor: i.kor === true
    };
    return {
      instellingen,
      rekeningen: ((rek.data ?? []) as Rij[]).map(naarRekening),
      grootboek: ((gb.data ?? []) as Rij[]).map(naarGrootboek),
      vennoten: ((ven.data ?? []) as Rij[]).map(naarVennoot),
      vergrendeling: {
        aangiften: ((aang.data ?? []) as Rij[])
          .map((a) => ({ jaar: Number(a.jaar), kwartaal: Number(a.kwartaal) }))
          .filter((a): a is { jaar: number; kwartaal: 1 | 2 | 3 | 4 } => isKwartaal(a.kwartaal)),
        boekjaren: ((jaren.data ?? []) as Rij[]).map((j) => Number(j.jaar))
      }
    };
  }

  async boekingen(): Promise<Boeking[]> {
    const { data, error } = await this.sb
      .from('bk_boekingen')
      .select(BOEKING_KOLOMMEN)
      .is('verwijderd_op', null)
      .order('datum', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20000);
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[]).map(naarBoeking);
  }

  async boeking(id: string): Promise<Boeking | null> {
    const { data, error } = await this.sb.from('bk_boekingen').select(BOEKING_KOLOMMEN).eq('id', id).is('verwijderd_op', null).maybeSingle();
    if (error) throw bkDbFout(error);
    return data ? naarBoeking(data as Rij) : null;
  }

  async boekingToevoegen(w: BoekingWaarde): Promise<Boeking> {
    const { data, error } = await this.sb.from('bk_boekingen').insert(naarRij(w)).select(BOEKING_KOLOMMEN).single();
    if (error) throw bkDbFout(error);
    return naarBoeking(data as Rij);
  }

  async boekingWijzigen(id: string, w: BoekingWaarde): Promise<Boeking> {
    const { data, error } = await this.sb.from('bk_boekingen').update(naarRij(w)).eq('id', id).is('verwijderd_op', null).select(BOEKING_KOLOMMEN).maybeSingle();
    if (error) throw bkDbFout(error);
    if (!data) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
    return naarBoeking(data as Rij);
  }

  async boekingVerwijderen(id: string, reden: string): Promise<void> {
    const { data, error } = await this.sb
      .from('bk_boekingen')
      .update({ verwijderd_op: new Date().toISOString(), verwijderd_door: this.userId, verwijder_reden: reden })
      .eq('id', id)
      .is('verwijderd_op', null)
      .select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
  }

  async rekeningToevoegen(r: RekeningInvoer): Promise<Rekening> {
    const { data, error } = await this.sb.rpc('bk_rekening_toevoegen', {
      p_naam: r.naam,
      p_iban: r.iban,
      p_formaat: r.importFormaat,
      p_beginsaldo: r.beginsaldo,
      p_begindatum: r.begindatum
    });
    if (error) throw bkDbFout(error);
    const rij = await this.sb.from('bk_rekeningen').select('*').eq('id', String(data)).single();
    if (rij.error) throw bkDbFout(rij.error);
    return naarRekening(rij.data as Rij);
  }

  async rekeningWijzigen(id: string, w: RekeningWijziging): Promise<Rekening> {
    const rij: Rij = {};
    if (w.naam !== undefined) rij.naam = w.naam;
    if (w.iban !== undefined) rij.iban = w.iban;
    if (w.importFormaat !== undefined) rij.import_formaat = w.importFormaat;
    if (w.beginsaldo !== undefined) rij.beginsaldo_centen = w.beginsaldo;
    if (w.begindatum !== undefined) rij.beginsaldo_datum = w.begindatum;
    if (w.actief !== undefined) rij.actief = w.actief;
    const { data, error } = await this.sb.from('bk_rekeningen').update(rij).eq('id', id).select('*').maybeSingle();
    if (error) throw bkDbFout(error);
    if (!data) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer).', 'onbekend');
    return naarRekening(data as Rij);
  }

  async standaardRekening(id: string): Promise<void> {
    const { error } = await this.sb.rpc('bk_standaard_rekening', { p_id: id });
    if (error) throw bkDbFout(error);
  }

  async importMappingOpslaan(rekeningId: string, mapping: Kolommapping | null): Promise<void> {
    const { data, error } = await this.sb.from('bk_rekeningen').update({ import_mapping: mapping }).eq('id', rekeningId).select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer).', 'onbekend');
  }

  async bronnen(): Promise<{ facturen: FactuurBron[]; uitgaven: UitgaveBron[] }> {
    // Alleen lezen. Kolommen expliciet (geen line_items/pdf); bestaan sinds 0013 en 0020.
    const [f, u] = await Promise.all([
      this.sb
        .from('invoices')
        .select('id, invoice_number, client_company_name, issued_at, subtotal, revenue_subtotal, vat_percentage, vat_amount, total, vat_reverse_charged, vat_reverse_charge_reason, deposit_percentage, remainder_of_invoice_id')
        .order('issued_at', { ascending: true })
        .limit(10000),
      this.sb
        .from('expenses')
        .select('id, expense_date, supplier, description, category, total_amount, vat_amount, vat_rate, currency, invoice_number, payment_method, status, created_by')
        .order('expense_date', { ascending: true })
        .limit(20000)
    ]);
    if (f.error && !tabelOntbreekt(f.error)) throw bkDbFout(f.error);
    if (u.error && !tabelOntbreekt(u.error)) throw bkDbFout(u.error);
    return {
      facturen: ((f.error ? [] : f.data ?? []) as Rij[]).map(factuurUitRij).filter((x): x is FactuurBron => x !== null),
      uitgaven: ((u.error ? [] : u.data ?? []) as Rij[]).map(uitgaveUitRij).filter((x): x is UitgaveBron => x !== null)
    };
  }

  async koppelingen(): Promise<Koppeling[]> {
    const { data, error } = await this.sb.from('bk_koppelingen').select('id, boeking_id, bron, bron_id, bedrag_centen, created_at').in('bron', ['factuur', 'uitgave']).limit(50000);
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[])
      .filter((r) => isKoppelBron(r.bron))
      .map((r) => ({ id: String(r.id), boekingId: String(r.boeking_id), bron: r.bron as KoppelBron, bronId: String(r.bron_id), bedrag: centen(r.bedrag_centen), aangemaakt: String(r.created_at) }));
  }

  async koppelingToevoegen(k: { boekingId: string; bron: KoppelBron; bronId: string; bedrag: number }): Promise<Koppeling> {
    const { data, error } = await this.sb
      .from('bk_koppelingen')
      .insert({ boeking_id: k.boekingId, bron: k.bron, bron_id: k.bronId, bedrag_centen: k.bedrag })
      .select('id, created_at')
      .single();
    if (error) throw bkDbFout(error);
    // Gekoppeld = verwerkt (de status mag ook in een vergrendelde periode wijzigen).
    const st = await this.sb.from('bk_boekingen').update({ status: 'geboekt' }).eq('id', k.boekingId).eq('status', 'te_verwerken');
    if (st.error) throw bkDbFout(st.error);
    const r = data as Rij;
    return { id: String(r.id), boekingId: k.boekingId, bron: k.bron, bronId: k.bronId, bedrag: k.bedrag, aangemaakt: String(r.created_at) };
  }

  async koppelingVerwijderen(id: string): Promise<void> {
    const { data, error } = await this.sb.from('bk_koppelingen').delete().eq('id', id).select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(404, 'Deze koppeling bestaat niet (meer).', 'onbekend');
  }

  async bronExtra(): Promise<BronExtra[]> {
    const { data, error } = await this.sb.from('bk_bron_extra').select('bron, bron_id, btw_code, grootboek_code, vennoot_id, notitie').limit(20000);
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[]).map(bronExtraUitRij).filter((x): x is BronExtra => x !== null);
  }

  async bronExtraOpslaan(e: BronExtra): Promise<BronExtra> {
    const { error } = await this.sb.from('bk_bron_extra').upsert(
      { bron: e.bron, bron_id: e.bronId, btw_code: e.btwCode, grootboek_code: e.grootboek, vennoot_id: e.vennootId, notitie: e.notitie },
      { onConflict: 'bron,bron_id' }
    );
    if (error) throw bkDbFout(error);
    return e;
  }

  async importSleutels(rekeningId: string): Promise<Set<string>> {
    const { data, error } = await this.sb.from('bk_boekingen').select('import_sleutel').eq('rekening_id', rekeningId).not('import_sleutel', 'is', null).limit(50000);
    if (error) throw bkDbFout(error);
    return new Set(((data ?? []) as Rij[]).map((r) => String(r.import_sleutel)));
  }

  async importeer(rekeningId: string, meta: { bestandsnaam: string; formaat: ImportFormaat }, regels: ImportBoeking[]): Promise<{ nieuw: number; dubbel: number }> {
    const { data, error } = await this.sb.rpc('bk_importeer', {
      p_rekening: rekeningId,
      p_bestandsnaam: meta.bestandsnaam,
      p_formaat: meta.formaat,
      p_regels: regels.map((r) => ({
        datum: r.datum,
        omschrijving: r.omschrijving,
        tegenpartij: r.tegenpartij ?? '',
        tegenrekening: r.tegenrekening ?? '',
        soort: r.soort,
        richting: r.richting,
        bedrag_centen: r.bedrag,
        btw_code: r.btwCode,
        btw_centen: r.btw,
        grootboek_code: r.grootboek ?? '',
        vennoot_id: r.vennootId ?? '',
        import_sleutel: r.sleutel,
        kenmerk: r.kenmerk ?? ''
      }))
    });
    if (error) throw bkDbFout(error);
    const d = (data ?? {}) as Rij;
    return { nieuw: Number(d.nieuw ?? 0), dubbel: Number(d.dubbel ?? 0) };
  }

  // ------------------------------------------------------------------ btw-aangiften
  async aangiften(): Promise<Aangifte[]> {
    const { data, error } = await this.sb.from('bk_aangiften').select(AANGIFTE_KOLOMMEN).order('jaar').order('kwartaal');
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[]).map(naarAangifte).filter((x): x is Aangifte => x !== null);
  }

  async aangifteIndienen(a: { jaar: number; kwartaal: Kwartaal; snapshot: AangifteSnapshot; teBetalen: number; kenmerk: string | null; opmerking: string | null }): Promise<Aangifte> {
    const { data, error } = await this.sb
      .from('bk_aangiften')
      .insert({ jaar: a.jaar, kwartaal: a.kwartaal, rubrieken: a.snapshot, te_betalen_centen: a.teBetalen, kenmerk: a.kenmerk, opmerking: a.opmerking })
      .select(AANGIFTE_KOLOMMEN)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') throw new BoekhoudFout(409, 'Dit kwartaal is al ingediend.', 'bestaat_al');
      throw bkDbFout(error);
    }
    const uit = naarAangifte(data as Rij);
    if (!uit) throw new BoekhoudFout(500, 'Er ging iets mis bij het opslaan van de aangifte.');
    return uit;
  }

  async aangifteIntrekken(id: string): Promise<void> {
    // RLS staat het verwijderen van een aangifte alleen de eigenaar toe. Daarna de
    // betaalkoppelingen (geen foreign key naar bk_aangiften); blijft er toch een over, dan
    // negeert laadAlles die (de aangifte bestaat niet meer).
    const { data, error } = await this.sb.from('bk_aangiften').delete().eq('id', id).select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(403, 'Alleen de eigenaar kan een ingediende aangifte intrekken.', 'geen_eigenaar');
    const k = await this.sb.from('bk_koppelingen').delete().eq('bron', 'aangifte').eq('bron_id', id);
    if (k.error) throw bkDbFout(k.error);
  }

  async aangifteBetalingen(): Promise<AangifteBetaling[]> {
    const { data, error } = await this.sb.from('bk_koppelingen').select('id, boeking_id, bron_id, bedrag_centen').eq('bron', 'aangifte').limit(5000);
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[]).map((r) => ({ id: String(r.id), boekingId: String(r.boeking_id), aangifteId: String(r.bron_id), bedrag: centen(r.bedrag_centen) }));
  }

  async aangifteBetalingKoppelen(k: { boekingId: string; aangifteId: string; bedrag: number }): Promise<AangifteBetaling> {
    const { data, error } = await this.sb
      .from('bk_koppelingen')
      .insert({ boeking_id: k.boekingId, bron: 'aangifte', bron_id: k.aangifteId, bedrag_centen: k.bedrag })
      .select('id')
      .single();
    if (error) throw bkDbFout(error);
    const st = await this.sb.from('bk_boekingen').update({ status: 'geboekt' }).eq('id', k.boekingId).eq('status', 'te_verwerken');
    if (st.error) throw bkDbFout(st.error);
    return { id: String((data as Rij).id), ...k };
  }

  async aangifteBetalingOntkoppelen(id: string): Promise<void> {
    const { data, error } = await this.sb.from('bk_koppelingen').delete().eq('id', id).eq('bron', 'aangifte').select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(404, 'Deze koppeling bestaat niet (meer).', 'onbekend');
  }

  // ------------------------------------------------------------------ activa
  async activa(): Promise<Activum[]> {
    const { data, error } = await this.sb.from('bk_activa').select(ACTIVUM_KOLOMMEN).order('aanschafdatum').limit(5000);
    if (error) throw bkDbFout(error);
    return ((data ?? []) as Rij[]).map(naarActivum).filter((x): x is Activum => x !== null);
  }

  async activumToevoegen(w: ActivumWaarde): Promise<Activum> {
    const { data, error } = await this.sb.from('bk_activa').insert(activumRij(w)).select(ACTIVUM_KOLOMMEN).single();
    if (error) throw bkDbFout(error);
    const a = naarActivum(data as Rij);
    if (!a) throw new BoekhoudFout(500, 'Er ging iets mis bij het opslaan van het activum.');
    return a;
  }

  async activumWijzigen(id: string, w: ActivumWaarde): Promise<Activum> {
    const { data, error } = await this.sb.from('bk_activa').update(activumRij(w)).eq('id', id).select(ACTIVUM_KOLOMMEN).maybeSingle();
    if (error) throw bkDbFout(error);
    const a = data ? naarActivum(data as Rij) : null;
    if (!a) throw new BoekhoudFout(404, 'Dit activum bestaat niet (meer).', 'onbekend');
    return a;
  }

  async activumVerwijderen(id: string): Promise<void> {
    const { data, error } = await this.sb.from('bk_activa').delete().eq('id', id).select('id');
    if (error) throw bkDbFout(error);
    if (!data?.length) throw new BoekhoudFout(404, 'Dit activum bestaat niet (meer).', 'onbekend');
  }
}
