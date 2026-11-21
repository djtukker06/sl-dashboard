import 'server-only';
import { fout, json } from '@/lib/agenda/api';
import { logFout } from '@/lib/log';
import { AppleAgendaFout } from './koppeling';

// Gedeelde stukken voor de routes onder /api/apple-agenda.

/** Een fout als nette JSON (code erbij, zodat het scherm "opnieuw koppelen" kan tonen). */
export function appleFoutAntwoord(e: unknown) {
  if (e instanceof AppleAgendaFout) {
    if (e.code === 'icloud') logFout('[apple-agenda]', `${e.code} ${e.detail}`);
    return fout(e.status, e.message, e.code);
  }
  logFout('[apple-agenda]', e);
  return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
}

export { json, fout };
