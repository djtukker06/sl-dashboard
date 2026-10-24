// Demo-opslag: voorbeeldgegevens in het geheugen van de server, per teamlid. Er wordt NIETS
// naar Supabase geschreven: dit bestand importeert bewust geen enkele Supabase-module
// (scripts/test-boekhouding.mjs controleert dat).
//
// Elk teamlid krijgt een eigen kopie van de seed; wijzigingen blijven maximaal 4 uur bewaard
// (of tot "Demo herstellen"). Beperking: op Vercel kan een volgend verzoek op een andere
// serverinstantie landen met een eigen geheugen; een demowijziging kan dan "verdwijnen".
// Dat is acceptabel voor een demo en staat in de banner-uitleg en de README.

import { MAX_CENTEN } from '../kern/geld';
import { vandaagNL } from '../kern/periode';
import { vergrendelFout, type Boeking, type BoekingWaarde, type Rekening } from '../model';
import { demoSeed, type DemoData } from './demo-seed';
import { BoekhoudFout, type BoekhoudRepo, type RekeningInvoer, type RekeningWijziging } from './types';

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
    this.muteer().boekingen.splice(i, 1);
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

  /** Dezelfde regels als de CHECK-constraints in 0027. */
  private controleer(w: BoekingWaarde) {
    const d = this.s.data;
    if (w.bedrag <= 0 || w.bedrag > MAX_CENTEN) throw new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
    if (w.rekeningId && !d.stamdata.rekeningen.some((r) => r.id === w.rekeningId)) throw new BoekhoudFout(400, 'Een gekozen rekening bestaat niet (meer).', 'ongeldig');
    if (w.soort === 'prive' && !w.vennootId) throw new BoekhoudFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.', 'ongeldig');
  }
}
