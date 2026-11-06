import 'server-only';
import { fout, json } from '@/lib/agenda/api';
import { logFout } from '@/lib/log';
import { GoogleAgendaFout } from './koppeling';

// Gedeelde stukken voor de routes onder /api/google-agenda.

/** Een fout als nette JSON (code erbij, zodat het scherm "opnieuw koppelen" kan tonen). */
export function googleFoutAntwoord(e: unknown) {
  if (e instanceof GoogleAgendaFout) {
    if (e.code === 'google') logFout('[google-agenda]', `${e.code} ${e.detail}`);
    return fout(e.status, e.message, e.code);
  }
  logFout('[google-agenda]', e);
  return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
}

export { json, fout };
