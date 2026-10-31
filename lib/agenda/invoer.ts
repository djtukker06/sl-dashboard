import {
  amsterdamNaarMoment,
  dagenTussen,
  inAmsterdam,
  isDag,
  normTijd,
  plusDagen,
  tijdNaarMinuten,
  weekdagIndex
} from './datum';
import { isHerhaling, minsteAfstandDagen, type Herhaling } from './herhaling';
import type { AfspraakInvoer, TaakInvoer } from './types';

// Handmatige validatie van de agenda-invoer (zoals lib/invoice/invoer.ts): de API-routes
// vertrouwen niets van de client en geven een Nederlandse foutmelding bij onzin.

export type Resultaat<T> = { ok: true; waarde: T } | { ok: false; fout: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}

function titelVan(v: unknown): Resultaat<string> {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!t) return { ok: false, fout: 'Geef een titel op.' };
  if (t.length > 300) return { ok: false, fout: 'De titel is te lang (maximaal 300 tekens).' };
  return { ok: true, waarde: t };
}

function tekstVan(v: unknown, max: number, naam: string): Resultaat<string> {
  if (v === null || v === undefined) return { ok: true, waarde: '' };
  if (typeof v !== 'string') return { ok: false, fout: `Ongeldige ${naam}.` };
  if (v.length > max) return { ok: false, fout: `De ${naam} is te lang (maximaal ${max} tekens).` };
  return { ok: true, waarde: v };
}

function klantVan(v: unknown): Resultaat<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, waarde: null };
  if (!isUuid(v)) return { ok: false, fout: 'Ongeldige klant.' };
  return { ok: true, waarde: v };
}

/** Kolommen van public.tasks die de API mag schrijven. */
export interface TaakRij {
  title?: string;
  notes?: string;
  due_date?: string | null;
  due_time?: string | null;
  duration_minutes?: number | null;
  priority?: number;
  client_id?: string | null;
  project_id?: string | null;
  completed_at?: string | null;
}

/**
 * Valideert een taak. `huidig` = de bestaande rij (bij PATCH), zodat combinaties
 * (tijd vereist datum) op de uitkomst worden gecontroleerd.
 */
export function parseTaak(
  body: TaakInvoer,
  huidig: { due_date: string | null; due_time: string | null; completed_at: string | null } | null
): Resultaat<TaakRij> {
  if (!body || typeof body !== 'object') return { ok: false, fout: 'Ongeldige invoer.' };
  const nieuw = huidig === null;
  const rij: TaakRij = {};

  if (nieuw || 'titel' in body) {
    const t = titelVan(body.titel);
    if (!t.ok) return t;
    rij.title = t.waarde;
  }
  if ('notitie' in body) {
    const n = tekstVan(body.notitie, 10000, 'notitie');
    if (!n.ok) return n;
    rij.notes = n.waarde;
  }
  if ('datum' in body) {
    if (body.datum === null || body.datum === '') rij.due_date = null;
    else if (isDag(body.datum)) rij.due_date = body.datum;
    else return { ok: false, fout: 'Ongeldige datum.' };
  }
  if ('tijd' in body) {
    if (body.tijd === null || body.tijd === '') rij.due_time = null;
    else {
      const t = normTijd(body.tijd);
      if (!t) return { ok: false, fout: 'Ongeldige tijd. Gebruik bijvoorbeeld 14:00.' };
      rij.due_time = t;
    }
  }
  if ('duur' in body) {
    if (body.duur === null || (body.duur as unknown) === '') rij.duration_minutes = null;
    else {
      const d = Number(body.duur);
      if (!Number.isInteger(d) || d < 5 || d > 1440) return { ok: false, fout: 'De duur moet tussen 5 minuten en 24 uur liggen.' };
      rij.duration_minutes = d;
    }
  }
  if ('prioriteit' in body) {
    const p = Number(body.prioriteit);
    if (![1, 2, 3].includes(p)) return { ok: false, fout: 'Ongeldige prioriteit.' };
    rij.priority = p;
  }
  if ('klantId' in body) {
    const k = klantVan(body.klantId);
    if (!k.ok) return k;
    rij.client_id = k.waarde;
  }
  if ('projectId' in body) {
    const pr = klantVan(body.projectId);
    if (!pr.ok) return { ok: false, fout: 'Ongeldig project.' };
    rij.project_id = pr.waarde;
  }
  if ('afgerond' in body) {
    if (typeof body.afgerond !== 'boolean') return { ok: false, fout: 'Ongeldige waarde voor afgerond.' };
    // Al afgerond blijft het oorspronkelijke moment staan.
    rij.completed_at = body.afgerond ? (huidig?.completed_at ?? new Date().toISOString()) : null;
  }

  // Zonder datum geen tijd: de datum weghalen haalt de tijd automatisch weg.
  const datum = 'due_date' in rij ? rij.due_date : (huidig?.due_date ?? null);
  const tijd = 'due_time' in rij ? rij.due_time : (huidig?.due_time ?? null);
  if (!datum && tijd) {
    if ('due_date' in rij && !('due_time' in rij)) rij.due_time = null;
    else return { ok: false, fout: 'Een tijd heeft een datum nodig.' };
  }
  return { ok: true, waarde: rij };
}

/** Kolommen van public.calendar_events die de API mag schrijven. */
export interface AfspraakRij {
  title?: string;
  notes?: string;
  location?: string;
  starts_at?: string;
  ends_at?: string;
  all_day?: boolean;
  client_id?: string | null;
  /** Migratie 0034. Alleen meegestuurd als er iets met herhalen verandert. */
  herhaling?: Herhaling | null;
  herhaal_tot?: string | null;
  herhaal_uitzonderingen?: string[];
  herhaal_van?: string | null;
}

/** De bestaande afspraak terugvertaald naar invoervelden (voor PATCH: samenvoegen en herberekenen). */
export function afspraakAlsInvoer(r: {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  herhaling?: string | null;
  herhaal_tot?: string | null;
}): AfspraakInvoer {
  const a = inAmsterdam(r.starts_at);
  const b = inAmsterdam(r.ends_at);
  const herhaal: AfspraakInvoer = {
    herhaling: isHerhaling(r.herhaling) ? r.herhaling : null,
    herhaalTot: isHerhaling(r.herhaling) ? (r.herhaal_tot ?? null) : null
  };
  if (r.all_day) {
    return { datum: a.dag, eindDatum: plusDagen(b.dag, -1), heleDag: true, start: null, eind: null, ...herhaal };
  }
  return {
    datum: a.dag,
    heleDag: false,
    start: a.tijd,
    eind: b.tijd,
    duur: Math.round((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000),
    ...herhaal
  };
}

export function parseAfspraak(body: AfspraakInvoer, huidig: AfspraakInvoer | null): Resultaat<AfspraakRij> {
  if (!body || typeof body !== 'object') return { ok: false, fout: 'Ongeldige invoer.' };
  const nieuw = huidig === null;
  const rij: AfspraakRij = {};

  if (nieuw || 'titel' in body) {
    const t = titelVan(body.titel);
    if (!t.ok) return t;
    rij.title = t.waarde;
  }
  if ('notitie' in body) {
    const n = tekstVan(body.notitie, 10000, 'notitie');
    if (!n.ok) return n;
    rij.notes = n.waarde;
  }
  if ('locatie' in body) {
    const l = tekstVan(body.locatie, 300, 'locatie');
    if (!l.ok) return l;
    rij.location = l.waarde.trim();
  }
  if ('klantId' in body) {
    const k = klantVan(body.klantId);
    if (!k.ok) return k;
    rij.client_id = k.waarde;
  }

  const tijdVelden = ['datum', 'eindDatum', 'start', 'eind', 'duur', 'heleDag', 'herhaling', 'herhaalTot'] as const;
  if (nieuw || tijdVelden.some((k) => k in body)) {
    // Bij wijzigen van alleen de datum (slepen naar een andere dag) blijven tijden en duur staan.
    const basis: AfspraakInvoer = huidig ?? {};
    const m: AfspraakInvoer = { ...basis, ...body };
    if ('start' in body && !('eind' in body)) {
      // Nieuwe begintijd zonder eind: zelfde duur aanhouden.
      m.eind = null;
    }
    if ('datum' in body && !('eindDatum' in body) && basis.datum && basis.eindDatum && isDag(body.datum)) {
      // Meerdaagse afspraak verplaatsen: de einddatum schuift evenveel mee.
      m.eindDatum = plusDagen(basis.eindDatum, dagenTussen(basis.datum, body.datum));
    }
    if (!isDag(m.datum)) return { ok: false, fout: 'Geef een geldige datum op.' };
    const heleDag = m.heleDag === true;

    if (heleDag) {
      let eindDag = m.datum;
      if (m.eindDatum) {
        if (!isDag(m.eindDatum)) return { ok: false, fout: 'Ongeldige einddatum.' };
        if (dagenTussen(m.datum, m.eindDatum) < 0) return { ok: false, fout: 'De einddatum ligt vóór de begindatum.' };
        if (dagenTussen(m.datum, m.eindDatum) > 366) return { ok: false, fout: 'Een afspraak kan maximaal een jaar duren.' };
        eindDag = m.eindDatum;
      }
      rij.all_day = true;
      rij.starts_at = amsterdamNaarMoment(m.datum).toISOString();
      rij.ends_at = amsterdamNaarMoment(plusDagen(eindDag, 1)).toISOString();
    } else {
      const start = normTijd(m.start);
      if (!start) return { ok: false, fout: 'Geef een begintijd op, of kies "hele dag".' };
      let duur: number;
      const eind = m.eind ? normTijd(m.eind) : null;
      if (m.eind && !eind) return { ok: false, fout: 'Ongeldige eindtijd.' };
      if (eind) {
        duur = tijdNaarMinuten(eind) - tijdNaarMinuten(start);
        if (duur <= 0) duur += 1440; // over middernacht
      } else {
        duur = m.duur === null || m.duur === undefined ? 60 : Number(m.duur);
        if (!Number.isInteger(duur) || duur < 5 || duur > 1440 * 14) return { ok: false, fout: 'Ongeldige duur.' };
      }
      const begin = amsterdamNaarMoment(m.datum, start);
      // Eindtijd als wandklok (zodat 10:00–11:00 op de wisseldag ook 11:00 eindigt).
      const eindMin = tijdNaarMinuten(start) + duur;
      const eindDag = plusDagen(m.datum, Math.floor(eindMin / 1440));
      const eindTijd = `${String(Math.floor((eindMin % 1440) / 60)).padStart(2, '0')}:${String(eindMin % 60).padStart(2, '0')}`;
      let einde = amsterdamNaarMoment(eindDag, eindTijd);
      if (einde.getTime() <= begin.getTime()) einde = new Date(begin.getTime() + duur * 60000);
      rij.all_day = false;
      rij.starts_at = begin.toISOString();
      rij.ends_at = einde.toISOString();
    }

    // Herhalen (migratie 0034). De kolommen staan alleen in de rij als het in de body staat,
    // zodat afspraken zonder herhaling ook werken zolang de migratie nog niet is uitgevoerd.
    const h = m.herhaling ?? null;
    if (h !== null && !isHerhaling(h)) return { ok: false, fout: 'Ongeldige herhaling.' };
    let tot: string | null = null;
    if (h) {
      if (m.herhaalTot !== null && m.herhaalTot !== undefined && m.herhaalTot !== '') {
        if (!isDag(m.herhaalTot)) return { ok: false, fout: 'Ongeldige datum bij "herhalen tot".' };
        if (dagenTussen(m.datum, m.herhaalTot) < 0) return { ok: false, fout: '"Herhalen tot" ligt vóór de eerste dag.' };
        tot = m.herhaalTot;
      }
      if (h === 'werkdagen' && weekdagIndex(m.datum) >= 5) {
        return { ok: false, fout: '"Elke werkdag" kan alleen op een werkdag beginnen.' };
      }
      const duurMs = Date.parse(rij.ends_at!) - Date.parse(rij.starts_at!);
      if (duurMs > minsteAfstandDagen(h) * 86_400_000) {
        return { ok: false, fout: 'De afspraak duurt langer dan de herhaling: kies een langere herhaling of een kortere afspraak.' };
      }
    }
    if (('herhaling' in body || 'herhaalTot' in body) && (h || !nieuw)) {
      rij.herhaling = h;
      rij.herhaal_tot = tot;
    }
  }
  return { ok: true, waarde: rij };
}

// Taken op naam (personen, subtaken, projecten): zie ./teaminvoer.ts (zonder imports, zodat
// scripts/test-taken.mjs het direct kan laden).
export {
  MAX_PERSONEN,
  MAX_SUBTAKEN,
  klantBijProject,
  parsePersonen,
  parseProject,
  parseSubtaakTitel,
  parseSubtaakWijziging,
  parseSubtaken,
  type ProjectRij
} from './teaminvoer';
