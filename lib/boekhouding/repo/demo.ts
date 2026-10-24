// Demo-opslag: voorbeeldgegevens in het geheugen van de server, per teamlid. Er wordt NIETS
// naar Supabase geschreven: dit bestand importeert bewust geen enkele Supabase-module
// (scripts/test-boekhouding.mjs controleert dat).
//
// Elk teamlid krijgt een eigen kopie van de seed; wijzigingen blijven maximaal 4 uur bewaard
// (of tot "Demo herstellen"). Beperking: op Vercel kan een volgend verzoek op een andere
// serverinstantie landen met een eigen geheugen; een demowijziging kan dan "verdwijnen".
// Dat is acceptabel voor een demo en staat in de banner-uitleg en de README.

import { MAX_CENTEN, type Centen } from '../kern/geld';
import { vandaagNL, vergrendeldReden } from '../kern/periode';
import { factuurPosten, koppelFout, koppelVergrendelFout, uitgavePosten } from '../kern/afletteren';
import type { BronExtra, KoppelBron, Koppeling } from '../kern/bronnen';
import type { ImportBoeking, Kolommapping } from '../kern/bankimport';
import { vergrendelFout, type Boeking, type BoekingWaarde, type ImportFormaat, type Rekening } from '../model';
import { demoSeed, type DemoData } from './demo-seed';
import { voorbeeldAfschriften } from './demo-voorbeeld';
import {
  BoekhoudFout,
  type BoekhoudRepo,
  type Boekjaar,
  type GrootboekInvoer,
  type GrootboekWijziging,
  type InstellingenWijziging,
  type MemoriaalInvoer,
  type RekeningInvoer,
  type RekeningWijziging
} from './types';
import type { Memoriaal, MemoriaalRegel } from '../kern/journaal';
import type { Grootboekrekening, Instellingen } from '../model';
import type { Aangifte, AangifteBetaling, AangifteSnapshot } from '../kern/aangifte';
import { activumVergrendelFout, type Activum, type ActivumWaarde } from '../kern/afschrijving';
import { isVergrendeld, type Kwartaal } from '../kern/periode';

const TTL_MS = 4 * 60 * 60 * 1000;
const MAX_MUTATIES = 1000;
const MAX_STORES = 50;

interface Store {
  gemaakt: number;
  mutaties: number;
  data: DemoData;
}

// Op globalThis, zodat hot reload in dev de demo niet steeds wist.
const g = globalThis as unknown as { __bkDemo?: Map<string, Store> };
const stores: Map<string, Store> = (g.__bkDemo ??= new Map());

function nieuweStore(): Store {
  return { gemaakt: Date.now(), mutaties: 0, data: demoSeed(vandaagNL()) };
}

function storeVan(sleutel: string): Store {
  const nu = Date.now();
  let s = stores.get(sleutel);
  if (!s || nu - s.gemaakt > TTL_MS) {
    s = nieuweStore();
    stores.set(sleutel, s);
    // Opruimen: verlopen stores en de oudste als het er te veel zijn.
    for (const [k, v] of stores) if (nu - v.gemaakt > TTL_MS) stores.delete(k);
    while (stores.size > MAX_STORES) stores.delete(stores.keys().next().value as string);
  }
  return s;
}

/** Zet de demo van dit teamlid terug naar de voorbeeldgegevens. */
export function demoHerstellen(sleutel: string): void {
  stores.set(sleutel, nieuweStore());
}

const kopie = <T>(v: T): T => structuredClone(v);

export class DemoRepo implements BoekhoudRepo {
  readonly modus = 'demo' as const;
  private sleutel: string;
  private userId: string | null;
  constructor(sleutel: string, userId: string | null = null) {
    this.sleutel = sleutel;
    this.userId = userId;
  }

  private get s(): Store {
    return storeVan(this.sleutel);
  }

  private muteer(): DemoData {
    const s = this.s;
    if (s.mutaties >= MAX_MUTATIES) throw new BoekhoudFout(429, 'De demo zit vol. Klik op "Demo herstellen" om opnieuw te beginnen.', 'demo_vol');
    s.mutaties++;
    return s.data;
  }

  async stamdata() {
    return kopie(this.s.data.stamdata);
  }

  async boekingen(): Promise<Boeking[]> {
    return kopie(this.s.data.boekingen);
  }

  async boeking(id: string): Promise<Boeking | null> {
    const b = this.s.data.boekingen.find((x) => x.id === id);
    return b ? kopie(b) : null;
  }

  async boekingToevoegen(w: BoekingWaarde): Promise<Boeking> {
    const d = this.s.data;
    const fout = vergrendelFout(null, w, d.stamdata.vergrendeling);
    if (fout) throw new BoekhoudFout(409, fout, 'periode_vergrendeld');
    this.controleer(w);
    const data = this.muteer();
    const nu = new Date().toISOString();
    const b: Boeking = {
      id: crypto.randomUUID(),
      ...w,
      tegenrekening: null,
      kenmerk: null,
      importId: null,
      aangemaakt: nu,
      aangemaaktDoor: this.userId,
      gewijzigd: nu
    };
    data.boekingen.push(b);
    return kopie(b);
  }

  async boekingWijzigen(id: string, w: BoekingWaarde): Promise<Boeking> {
    const d = this.s.data;
    const i = d.boekingen.findIndex((x) => x.id === id);
    if (i < 0) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
    const fout = vergrendelFout(d.boekingen[i], w, d.stamdata.vergrendeling);
    if (fout) throw new BoekhoudFout(409, fout, 'periode_vergrendeld');
    this.controleer(w);
    const data = this.muteer();
    const b: Boeking = { ...data.boekingen[i], ...w, gewijzigd: new Date().toISOString() };
    data.boekingen[i] = b;
    return kopie(b);
  }

  async boekingVerwijderen(id: string, reden: string): Promise<void> {
    const d = this.s.data;
    const i = d.boekingen.findIndex((x) => x.id === id);
    if (i < 0) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
    const fout = vergrendelFout(d.boekingen[i], null, d.stamdata.vergrendeling);
    if (fout) throw new BoekhoudFout(409, fout, 'periode_vergrendeld');
    if (!reden.trim()) throw new BoekhoudFout(400, 'Geef een reden op.', 'ongeldig');
    const data = this.muteer();
    data.koppelingen = data.koppelingen.filter((k) => k.boekingId !== id);
    data.boekingen.splice(i, 1);
  }

  async rekeningToevoegen(r: RekeningInvoer): Promise<Rekening> {
    const d = this.s.data;
    if (d.stamdata.rekeningen.some((x) => x.naam.toLowerCase() === r.naam.toLowerCase())) {
      throw new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
    }
    const vrij = Array.from({ length: 10 }, (_, k) => String(1100 + 10 * k)).find((c) => !d.stamdata.grootboek.some((x) => x.code === c));
    if (!vrij) throw new BoekhoudFout(400, 'Er kunnen maximaal 10 bankrekeningen zijn.', 'te_veel');
    const data = this.muteer();
    data.stamdata.grootboek.push({
      code: vrij,
      naam: `Bank ${r.naam}`.slice(0, 120),
      soort: 'activa',
      rubriek: 'liquide_middelen',
      rgs: 'BLim',
      btw: null,
      systeem: false,
      actief: true,
      hint: null,
      volgorde: Number(vrij)
    });
    const rek: Rekening = {
      id: crypto.randomUUID(),
      naam: r.naam,
      iban: r.iban,
      grootboek: vrij,
      standaard: false,
      importFormaat: r.importFormaat,
      beginsaldo: r.beginsaldo,
      begindatum: r.begindatum,
      actief: true,
      volgorde: Math.max(0, ...data.stamdata.rekeningen.map((x) => x.volgorde)) + 1
    };
    data.stamdata.rekeningen.push(rek);
    return kopie(rek);
  }

  async rekeningWijzigen(id: string, w: RekeningWijziging): Promise<Rekening> {
    const d = this.s.data;
    const rek = d.stamdata.rekeningen.find((x) => x.id === id);
    if (!rek) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer).', 'onbekend');
    if (w.naam && d.stamdata.rekeningen.some((x) => x.id !== id && x.naam.toLowerCase() === w.naam!.toLowerCase())) {
      throw new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
    }
    this.muteer();
    Object.assign(rek, Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)));
    return kopie(rek);
  }

  async standaardRekening(id: string): Promise<void> {
    const d = this.s.data;
    if (!d.stamdata.rekeningen.some((x) => x.id === id && x.actief)) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer) of is niet actief.', 'onbekend');
    this.muteer();
    for (const r of d.stamdata.rekeningen) r.standaard = r.id === id;
  }

  async importMappingOpslaan(rekeningId: string, mapping: Kolommapping | null): Promise<void> {
    const rek = this.s.data.stamdata.rekeningen.find((x) => x.id === rekeningId);
    if (!rek) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer).', 'onbekend');
    this.muteer();
    rek.importMapping = mapping ? { ...mapping } : null;
  }

  async bronnen() {
    const d = this.s.data;
    return { facturen: kopie(d.facturen), uitgaven: kopie(d.uitgaven) };
  }

  async koppelingen(): Promise<Koppeling[]> {
    const d = this.s.data;
    const ids = new Set(d.boekingen.map((b) => b.id));
    return kopie(d.koppelingen.filter((k) => ids.has(k.boekingId)));
  }

  async koppelingToevoegen(k: { boekingId: string; bron: KoppelBron; bronId: string; bedrag: Centen }): Promise<Koppeling> {
    const d = this.s.data;
    const b = d.boekingen.find((x) => x.id === k.boekingId);
    if (!b) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
    const vandaag = vandaagNL();
    const ids = new Set(d.boekingen.map((x) => x.id));
    const actief = d.koppelingen.filter((x) => ids.has(x.boekingId));
    const post =
      k.bron === 'factuur'
        ? factuurPosten(d.facturen.filter((f) => f.id === k.bronId), actief, vandaag)[0]
        : uitgavePosten(d.uitgaven.filter((u) => u.id === k.bronId), actief, vandaag)[0];
    if (!post) throw new BoekhoudFout(404, k.bron === 'factuur' ? 'Deze factuur bestaat niet (meer).' : 'Dit bonnetje bestaat niet (meer) of telt niet mee.', 'onbekend');
    const fout = koppelFout(b, { bron: k.bron, id: k.bronId, totaal: post.totaal, open: post.open }, k.bedrag, actief, d.stamdata.vergrendeling);
    if (fout) throw koppelVergrendelFout(b, d.stamdata.vergrendeling) ? new BoekhoudFout(409, fout, 'periode_vergrendeld') : new BoekhoudFout(400, fout, 'koppeling_ongeldig');
    const data = this.muteer();
    const nieuw: Koppeling = { id: crypto.randomUUID(), boekingId: b.id, bron: k.bron, bronId: k.bronId, bedrag: k.bedrag, aangemaakt: new Date().toISOString() };
    data.koppelingen.push(nieuw);
    if (b.status === 'te_verwerken') b.status = 'geboekt';
    return kopie(nieuw);
  }

  async koppelingVerwijderen(id: string): Promise<void> {
    const d = this.s.data;
    const i = d.koppelingen.findIndex((k) => k.id === id);
    if (i < 0) throw new BoekhoudFout(404, 'Deze koppeling bestaat niet (meer).', 'onbekend');
    const b = d.boekingen.find((x) => x.id === d.koppelingen[i].boekingId);
    const slot = b ? koppelVergrendelFout(b, d.stamdata.vergrendeling) : null;
    if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
    this.muteer().koppelingen.splice(i, 1);
  }

  async bronExtra(): Promise<BronExtra[]> {
    return kopie(this.s.data.bronExtra);
  }

  async bronExtraOpslaan(e: BronExtra): Promise<BronExtra> {
    const d = this.s.data;
    const doc = e.bron === 'factuur' ? d.facturen.find((f) => f.id === e.bronId) : d.uitgaven.find((u) => u.id === e.bronId);
    if (!doc) throw new BoekhoudFout(404, 'Dit document bestaat niet (meer).', 'onbekend');
    const datum = doc.datum;
    const oud = d.bronExtra.find((x) => x.bron === e.bron && x.bronId === e.bronId);
    const financieel = !oud || oud.btwCode !== e.btwCode || oud.grootboek !== e.grootboek || oud.vennootId !== e.vennootId;
    const slot = datum && financieel ? vergrendeldReden(datum, d.stamdata.vergrendeling) : null;
    if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
    const data = this.muteer();
    data.bronExtra = data.bronExtra.filter((x) => !(x.bron === e.bron && x.bronId === e.bronId));
    data.bronExtra.push({ ...e });
    return kopie(e);
  }

  async importSleutels(rekeningId: string): Promise<Set<string>> {
    return new Set(this.s.data.importSleutels[rekeningId] ?? []);
  }

  async importeer(rekeningId: string, _meta: { bestandsnaam: string; formaat: ImportFormaat }, regels: ImportBoeking[]): Promise<{ nieuw: number; dubbel: number }> {
    const d = this.s.data;
    if (!d.stamdata.rekeningen.some((r) => r.id === rekeningId && r.actief)) throw new BoekhoudFout(404, 'Die rekening bestaat niet (meer) of is niet actief.', 'onbekend');
    for (const r of regels) {
      const slot = vergrendeldReden(r.datum, d.stamdata.vergrendeling);
      if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
      this.controleer({ ...r, rekeningId });
    }
    const data = this.muteer();
    const bestaand = new Set(data.importSleutels[rekeningId] ?? []);
    const importId = crypto.randomUUID();
    let nieuw = 0;
    const nu = new Date().toISOString();
    for (const r of regels) {
      if (bestaand.has(r.sleutel)) continue;
      bestaand.add(r.sleutel);
      const w: BoekingWaarde = {
        rekeningId,
        datum: r.datum,
        omschrijving: r.omschrijving,
        tegenpartij: r.tegenpartij,
        soort: r.soort,
        richting: r.richting,
        bedrag: r.bedrag,
        isExcl: r.isExcl,
        btwCode: r.btwCode,
        btw: r.btw,
        btwHandmatig: r.btwHandmatig,
        grootboek: r.grootboek,
        vennootId: r.vennootId,
        status: 'te_verwerken',
        notities: r.notities
      };
      const { tegenrekening, kenmerk } = r;
      data.boekingen.push({ id: crypto.randomUUID(), ...w, status: 'te_verwerken', tegenrekening, kenmerk, importId, aangemaakt: nu, aangemaaktDoor: this.userId, gewijzigd: nu });
      nieuw++;
    }
    data.importSleutels[rekeningId] = [...bestaand];
    return { nieuw, dubbel: regels.length - nieuw };
  }

  // ------------------------------------------------------------------ btw-aangiften
  async aangiften(): Promise<Aangifte[]> {
    return kopie(this.s.data.aangiften);
  }

  async aangifteIndienen(a: { jaar: number; kwartaal: Kwartaal; snapshot: AangifteSnapshot; teBetalen: Centen; kenmerk: string | null; opmerking: string | null }): Promise<Aangifte> {
    const d = this.s.data;
    if (d.aangiften.some((x) => x.jaar === a.jaar && x.kwartaal === a.kwartaal)) throw new BoekhoudFout(409, 'Dit kwartaal is al ingediend.', 'bestaat_al');
    if (d.stamdata.vergrendeling.boekjaren.includes(a.jaar)) throw new BoekhoudFout(409, `Boekjaar ${a.jaar} is afgesloten.`, 'periode_vergrendeld');
    const data = this.muteer();
    const nieuw: Aangifte = {
      id: crypto.randomUUID(),
      jaar: a.jaar,
      kwartaal: a.kwartaal,
      ingediendOp: new Date().toISOString(),
      ingediendDoor: this.userId,
      kenmerk: a.kenmerk,
      opmerking: a.opmerking,
      snapshot: structuredClone(a.snapshot),
      teBetalen: a.teBetalen
    };
    data.aangiften.push(nieuw);
    data.stamdata.vergrendeling.aangiften.push({ jaar: a.jaar, kwartaal: a.kwartaal });
    return kopie(nieuw);
  }

  async aangifteIntrekken(id: string): Promise<void> {
    const d = this.s.data;
    const a = d.aangiften.find((x) => x.id === id);
    if (!a) throw new BoekhoudFout(404, 'Deze aangifte bestaat niet (meer).', 'onbekend');
    if (d.stamdata.vergrendeling.boekjaren.includes(a.jaar)) throw new BoekhoudFout(409, `Boekjaar ${a.jaar} is afgesloten.`, 'periode_vergrendeld');
    const data = this.muteer();
    data.aangiften = data.aangiften.filter((x) => x.id !== id);
    data.aangifteBetalingen = data.aangifteBetalingen.filter((x) => x.aangifteId !== id);
    data.stamdata.vergrendeling.aangiften = data.stamdata.vergrendeling.aangiften.filter((x) => !(x.jaar === a.jaar && x.kwartaal === a.kwartaal));
  }

  async aangifteBetalingen(): Promise<AangifteBetaling[]> {
    const d = this.s.data;
    const ids = new Set(d.boekingen.map((b) => b.id));
    return kopie(d.aangifteBetalingen.filter((k) => ids.has(k.boekingId)));
  }

  async aangifteBetalingKoppelen(k: { boekingId: string; aangifteId: string; bedrag: Centen }): Promise<AangifteBetaling> {
    const d = this.s.data;
    const b = d.boekingen.find((x) => x.id === k.boekingId);
    if (!b) throw new BoekhoudFout(404, 'Deze boeking bestaat niet (meer).', 'onbekend');
    if (b.soort !== 'btw') throw new BoekhoudFout(400, 'Deze koppeling past niet bij de boeking (soort of verwijderd).', 'koppeling_ongeldig');
    if (!d.aangiften.some((a) => a.id === k.aangifteId)) throw new BoekhoudFout(404, 'Deze aangifte bestaat niet (meer).', 'onbekend');
    if (d.aangifteBetalingen.some((x) => x.boekingId === k.boekingId && x.aangifteId === k.aangifteId)) throw new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
    const data = this.muteer();
    const nieuw: AangifteBetaling = { id: crypto.randomUUID(), ...k };
    data.aangifteBetalingen.push(nieuw);
    if (b.status === 'te_verwerken') b.status = 'geboekt';
    return kopie(nieuw);
  }

  async aangifteBetalingOntkoppelen(id: string): Promise<void> {
    const d = this.s.data;
    if (!d.aangifteBetalingen.some((x) => x.id === id)) throw new BoekhoudFout(404, 'Deze koppeling bestaat niet (meer).', 'onbekend');
    const data = this.muteer();
    data.aangifteBetalingen = data.aangifteBetalingen.filter((x) => x.id !== id);
  }

  // ------------------------------------------------------------------ activa
  async activa(): Promise<Activum[]> {
    return kopie(this.s.data.activa);
  }

  private activumSlot(oud: Activum | null, nieuw: ActivumWaarde | null) {
    const v = this.s.data.stamdata.vergrendeling;
    const fout = activumVergrendelFout(oud, nieuw, { boekjaren: v.boekjaren, open: (dt) => !isVergrendeld(dt, v) });
    if (fout) throw new BoekhoudFout(409, fout, 'periode_vergrendeld');
  }

  async activumToevoegen(w: ActivumWaarde): Promise<Activum> {
    this.activumSlot(null, w);
    const data = this.muteer();
    const a: Activum = { id: crypto.randomUUID(), ...w, aangemaakt: new Date().toISOString() };
    data.activa.push(a);
    return kopie(a);
  }

  async activumWijzigen(id: string, w: ActivumWaarde): Promise<Activum> {
    const d = this.s.data;
    const i = d.activa.findIndex((x) => x.id === id);
    if (i < 0) throw new BoekhoudFout(404, 'Dit activum bestaat niet (meer).', 'onbekend');
    this.activumSlot(d.activa[i], w);
    const data = this.muteer();
    data.activa[i] = { ...data.activa[i], ...w };
    return kopie(data.activa[i]);
  }

  async activumVerwijderen(id: string): Promise<void> {
    const d = this.s.data;
    const a = d.activa.find((x) => x.id === id);
    if (!a) throw new BoekhoudFout(404, 'Dit activum bestaat niet (meer).', 'onbekend');
    this.activumSlot(a, null);
    const data = this.muteer();
    data.activa = data.activa.filter((x) => x.id !== id);
  }

  // ------------------------------------------------------------------ memoriaal en boekjaren
  async memoriaal(): Promise<Memoriaal[]> {
    return kopie(this.s.data.memoriaal ?? []);
  }

  async memoriaalToevoegen(m: MemoriaalInvoer): Promise<Memoriaal> {
    const d = this.s.data;
    const slot = vergrendeldReden(m.datum, d.stamdata.vergrendeling);
    if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
    sluitOfFout(m.regels);
    const data = this.muteer();
    const nieuw: Memoriaal = { id: crypto.randomUUID(), datum: m.datum, omschrijving: m.omschrijving, soort: m.soort, regels: kopie(m.regels), aangemaakt: new Date().toISOString() };
    (data.memoriaal ??= []).push(nieuw);
    return kopie(nieuw);
  }

  async memoriaalVerwijderen(id: string): Promise<void> {
    const d = this.s.data;
    const m = (d.memoriaal ?? []).find((x) => x.id === id);
    if (!m) throw new BoekhoudFout(404, 'Deze memoriaalpost bestaat niet (meer).', 'onbekend');
    if (m.soort === 'jaarafsluiting') throw new BoekhoudFout(400, 'Een jaarafsluiting maak je ongedaan door het boekjaar te heropenen.', 'ongeldig');
    const slot = vergrendeldReden(m.datum, d.stamdata.vergrendeling);
    if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
    const data = this.muteer();
    data.memoriaal = data.memoriaal.filter((x) => x.id !== id);
  }

  async boekjaren(): Promise<Boekjaar[]> {
    return kopie(this.s.data.boekjaren ?? []);
  }

  async jaarAfsluiten(a: { jaar: number; omschrijving: string; regels: MemoriaalRegel[]; samenvatting: Record<string, unknown> }): Promise<Boekjaar> {
    const d = this.s.data;
    const jaren = d.boekjaren ?? [];
    if (jaren.some((j) => j.jaar === a.jaar)) throw new BoekhoudFout(409, 'Dit boekjaar is al afgesloten.', 'bestaat_al');
    if (jaren.some((j) => j.jaar > a.jaar)) throw new BoekhoudFout(409, 'Een later boekjaar is al afgesloten.', 'jaar_volgorde');
    if (a.regels.length) sluitOfFout(a.regels);
    const data = this.muteer();
    let memoriaalId: string | null = null;
    if (a.regels.length) {
      memoriaalId = crypto.randomUUID();
      (data.memoriaal ??= []).push({ id: memoriaalId, datum: `${a.jaar}-12-31`, omschrijving: a.omschrijving, soort: 'jaarafsluiting', regels: kopie(a.regels), aangemaakt: new Date().toISOString() });
    }
    const bj: Boekjaar = { jaar: a.jaar, afgeslotenOp: new Date().toISOString(), afgeslotenDoor: this.userId, memoriaalId, samenvatting: kopie(a.samenvatting) };
    (data.boekjaren ??= []).push(bj);
    data.stamdata.vergrendeling.boekjaren = [...data.stamdata.vergrendeling.boekjaren.filter((j) => j !== a.jaar), a.jaar].sort();
    return kopie(bj);
  }

  async jaarHeropenen(jaar: number): Promise<void> {
    const d = this.s.data;
    const jaren = d.boekjaren ?? [];
    if (!jaren.some((j) => j.jaar === jaar)) throw new BoekhoudFout(404, 'Dit boekjaar is niet afgesloten.', 'onbekend');
    if (jaren.some((j) => j.jaar > jaar)) throw new BoekhoudFout(409, 'Heropen eerst het latere boekjaar.', 'jaar_volgorde');
    const data = this.muteer();
    data.boekjaren = jaren.filter((j) => j.jaar !== jaar);
    data.memoriaal = (data.memoriaal ?? []).filter((m) => !(m.soort === 'jaarafsluiting' && m.datum.startsWith(`${jaar}-`)));
    data.stamdata.vergrendeling.boekjaren = data.stamdata.vergrendeling.boekjaren.filter((j) => j !== jaar);
  }

  // ------------------------------------------------------------------ instellingen
  async instellingenWijzigen(w: InstellingenWijziging): Promise<Instellingen> {
    const data = this.muteer();
    Object.assign(data.stamdata.instellingen, Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)));
    return kopie(data.stamdata.instellingen);
  }

  async aandelenWijzigen(a: { id: string; aandeel: number }[]): Promise<void> {
    const d = this.s.data;
    const na = d.stamdata.vennoten.map((v) => ({ ...v, aandeel: a.find((x) => x.id === v.id)?.aandeel ?? v.aandeel }));
    const somA = na.filter((v) => v.actief).reduce((t, v) => t + Math.round(v.aandeel * 100), 0);
    if (somA !== 10000) throw new BoekhoudFout(400, `De aandelen tellen op tot ${somA / 100}%; dat moet 100% zijn.`, 'ongeldig');
    this.muteer().stamdata.vennoten = na;
  }

  async grootboekToevoegen(g: GrootboekInvoer): Promise<Grootboekrekening> {
    const d = this.s.data;
    if (d.stamdata.grootboek.some((x) => x.code === g.code || x.naam.toLowerCase() === g.naam.toLowerCase())) throw new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
    const data = this.muteer();
    const nieuw: Grootboekrekening = { code: g.code, naam: g.naam, soort: g.soort, rubriek: g.soort === 'kosten' ? 'kosten' : 'omzet', rgs: g.soort === 'kosten' ? 'WBed' : 'WOmz', btw: g.btw, systeem: false, actief: true, hint: null, volgorde: Number(g.code) };
    data.stamdata.grootboek.push(nieuw);
    data.stamdata.grootboek.sort((x, y) => (x.code < y.code ? -1 : 1));
    return kopie(nieuw);
  }

  async grootboekWijzigen(code: string, w: GrootboekWijziging): Promise<Grootboekrekening> {
    const d = this.s.data;
    const g = d.stamdata.grootboek.find((x) => x.code === code);
    if (!g) throw new BoekhoudFout(404, 'Deze rekening bestaat niet (meer).', 'onbekend');
    if (g.systeem && (w.actief === false || w.naam !== undefined)) throw new BoekhoudFout(400, 'Dit is een vaste rekening van het systeem.', 'grootboek_systeem');
    if (w.naam && d.stamdata.grootboek.some((x) => x.code !== code && x.naam.toLowerCase() === w.naam!.toLowerCase())) throw new BoekhoudFout(409, 'Dat bestaat al (zelfde naam of nummer).', 'bestaat_al');
    this.muteer();
    if (w.naam !== undefined) g.naam = w.naam;
    if (w.actief !== undefined) g.actief = w.actief;
    if (w.btw !== undefined) g.btw = w.btw;
    return kopie(g);
  }

  /** Voorbeeld-CSV's (RegioBank en Revolut) om de import in de demo te proberen. */
  voorbeeldAfschriften(): { regiobank: string; revolut: string } {
    return voorbeeldAfschriften(this.s.data, vandaagNL());
  }

  /** Dezelfde regels als de CHECK-constraints in 0027. */
  private controleer(w: BoekingWaarde) {
    const d = this.s.data;
    if (w.bedrag <= 0 || w.bedrag > MAX_CENTEN) throw new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
    if (w.rekeningId && !d.stamdata.rekeningen.some((r) => r.id === w.rekeningId)) throw new BoekhoudFout(400, 'Een gekozen rekening bestaat niet (meer).', 'ongeldig');
    if (w.soort === 'prive' && !w.vennootId) throw new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
  }
}

function sluitOfFout(regels: readonly MemoriaalRegel[]) {
  let d = 0;
  let c = 0;
  for (const r of regels) {
    if (!Number.isSafeInteger(r.debet) || !Number.isSafeInteger(r.credit) || r.debet < 0 || r.credit < 0 || (r.debet > 0) === (r.credit > 0)) {
      throw new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
    }
    d += r.debet;
    c += r.credit;
  }
  if (d !== c) throw new BoekhoudFout(400, 'De memoriaalpost sluit niet (debet ≠ credit).', 'sluit_niet');
}
