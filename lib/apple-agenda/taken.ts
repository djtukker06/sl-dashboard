import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Taak } from '@/lib/agenda/types';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { taakBestand, taakIcs } from './ics-kern';
import { AppleAgendaFout, davVoor } from './koppeling';
import { itemUrl, schrijf, vindAgenda } from './afspraken';

// Taken in Apple Agenda (migratie 0041): bij een taak kies je een van je Apple-agenda's; het
// systeem zet er dan een afspraak voor in (lib/apple-agenda/ics-kern.ts taakIcs) en houdt die
// bij als de taak verandert: titel, datum, tijd, afgerond (✓) en verwijderen. Alleen in die
// richting. Wie de taak ook wijzigt (een collega die erop staat): de afspraak gaat altijd via
// het Apple-account van wie de agenda koppelde.

interface Koppeling {
  task_id: string;
  agenda_id: string;
  user_id: string;
}

async function koppelingVan(service: SupabaseClient, taakId: string): Promise<Koppeling | null> {
  const { data, error } = await service.from('apple_taak_koppelingen').select('task_id, agenda_id, user_id').eq('task_id', taakId).maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return null;
    throw error;
  }
  return (data as Koppeling | null) ?? null;
}

/** In welke van JOUW Apple-agenda's deze taak staat (voor het taakvenster), of null. */
export async function appleAgendaVanTaak(service: SupabaseClient, userId: string, taakId: string): Promise<string | null> {
  try {
    const k = await koppelingVan(service, taakId);
    return k && k.user_id === userId ? k.agenda_id : null;
  } catch {
    return null;
  }
}

async function haalWeg(service: SupabaseClient, k: Koppeling) {
  const { agenda, v } = await vindAgenda(service, k.user_id, k.agenda_id);
  const r = await davVoor(v, itemUrl(agenda, taakBestand(k.task_id)), 'DELETE');
  if (r.status !== 404 && r.status !== 410 && (r.status < 200 || r.status >= 300)) throw new AppleAgendaFout('icloud', undefined, `delete ${r.status}`);
}

export interface TaakSyncUitkomst {
  /** In welke van jouw Apple-agenda's de taak nu staat (null = alleen in het systeem). */
  appleAgendaId: string | null;
  /** Een melding als het bijwerken in Apple niet lukte (de taak zelf is wel opgeslagen). */
  appleFout?: string;
}

/**
 * Na het opslaan van een taak: de afspraak in Apple bijwerken. `keuze` = wat je in het
 * taakvenster koos (undefined = niet gewijzigd, null = alleen in het systeem, anders het
 * id van een van jouw Apple-agenda's). Best effort: de taak is al opgeslagen.
 */
export async function taakNaarApple(service: SupabaseClient, userId: string, taak: Taak, keuze?: string | null): Promise<TaakSyncUitkomst> {
  let k: Koppeling | null = null;
  try {
    k = await koppelingVan(service, taak.id);
    if (keuze !== undefined && (k?.agenda_id ?? null) !== keuze) {
      if (keuze) {
        // Alleen een eigen, schrijfbare agenda.
        const { agenda } = await vindAgenda(service, userId, keuze);
        if (!agenda.schrijfbaar) throw new AppleAgendaFout('geen_recht', 'In deze Apple-agenda kun je niets zetten.');
      }
      if (k) {
        await haalWeg(service, k).catch((e) => logFout('[apple-taken] oude afspraak weghalen', e));
        await service.from('apple_taak_koppelingen').delete().eq('task_id', taak.id);
        k = null;
      }
      if (keuze) {
        const { error } = await service.from('apple_taak_koppelingen').insert({ task_id: taak.id, agenda_id: keuze, user_id: userId });
        if (error) throw tabelOntbreekt(error) ? new AppleAgendaFout('tabel_ontbreekt') : error;
        k = { task_id: taak.id, agenda_id: keuze, user_id: userId };
      }
    }
    if (!k) return { appleAgendaId: null };
    const mijn = k.user_id === userId ? k.agenda_id : null;
    const ics = taakIcs(taak);
    if (!ics) {
      // Geen datum (meer): uit de agenda, de keuze blijft (met een datum komt hij terug).
      await haalWeg(service, k);
      return { appleAgendaId: mijn };
    }
    const { agenda, v } = await vindAgenda(service, k.user_id, k.agenda_id);
    await schrijf(v, agenda, taakBestand(taak.id), ics, {});
    return { appleAgendaId: mijn };
  } catch (e) {
    if (!(e instanceof AppleAgendaFout) || e.code === 'icloud') logFout('[apple-taken] bijwerken', e);
    const melding = e instanceof AppleAgendaFout ? e.message : 'Bijwerken in Apple Agenda is niet gelukt.';
    return { appleAgendaId: k && k.user_id === userId ? k.agenda_id : null, appleFout: `Taak opgeslagen, maar niet in Apple Agenda: ${melding}` };
  }
}

/** Vóór het verwijderen van een taak: de afspraak in Apple weghalen (best effort). */
export async function taakUitApple(service: SupabaseClient, taakId: string): Promise<void> {
  try {
    const k = await koppelingVan(service, taakId);
    if (k) await haalWeg(service, k);
  } catch (e) {
    logFout('[apple-taken] weghalen', e);
  }
}
